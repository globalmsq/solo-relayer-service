import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpService } from "@nestjs/axios";
import axios, { AxiosError } from "axios";
import { ethers } from "ethers";

/**
 * ERC2771Forwarder execute() function ABI
 * OpenZeppelin ERC2771Forwarder v5.x signature
 */
const FORWARDER_EXECUTE_ABI = [
  "function execute((address from, address to, uint256 value, uint256 gas, uint48 deadline, bytes data, bytes signature) request)",
];

/**
 * OzRelayerClient - Queue Consumer's OZ Relayer Integration
 *
 * SPEC-QUEUE-001: Matches relay-api's OzRelayerService pattern
 * - Uses Bearer token authentication
 * - Fetches relayer ID before sending transactions
 * - Sends to /api/v1/relayers/:relayerId/transactions endpoint
 * - Handles both direct and gasless transaction types
 */
@Injectable()
export class OzRelayerClient {
  private readonly logger = new Logger(OzRelayerClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private relayerId: string | null = null;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.baseUrl =
      this.configService.get<string>("relayer.url") || "http://localhost:8081";
    this.apiKey =
      this.configService.get<string>("relayer.apiKey") ||
      "oz-relayer-shared-api-key-local-dev";
  }

  /**
   * Fetch the relayer ID from OZ Relayer with caching
   * Matches relay-api's OzRelayerService.getRelayerId() pattern
   */
  private async getRelayerId(): Promise<string> {
    // Return cached ID if available
    if (this.relayerId) {
      return this.relayerId;
    }

    try {
      this.logger.debug(
        `Fetching relayer ID from: ${this.baseUrl}/api/v1/relayers`,
      );

      const response = await axios.get<{ data: Array<{ id: string }> }>(
        `${this.baseUrl}/api/v1/relayers`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        },
      );

      if (response.data?.data?.[0]?.id) {
        this.relayerId = response.data.data[0].id;
        this.logger.log(`Discovered relayer ID: ${this.relayerId}`);
        return this.relayerId;
      }

      throw new Error("No relayer found in response");
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to discover relayer ID: ${axiosError.message}`,
        axiosError.response?.data,
      );
      throw new Error("Failed to discover OZ Relayer ID");
    }
  }

  /**
   * Build the forwarder execute() calldata for gasless transactions
   *
   * @param forwardRequest - The ForwardRequest struct from the gasless message
   * @param signature - The EIP-712 signature
   * @returns Hex-encoded calldata for execute() function
   */
  private buildForwarderExecuteCalldata(
    forwardRequest: {
      from: string;
      to: string;
      value: string;
      gas: string;
      nonce: string;
      deadline: string;
      data: string;
    },
    signature: string,
  ): string {
    const forwarderInterface = new ethers.Interface(FORWARDER_EXECUTE_ABI);

    // Build the ForwardRequestData struct matching OpenZeppelin v5.x
    const requestData = {
      from: forwardRequest.from,
      to: forwardRequest.to,
      value: BigInt(forwardRequest.value),
      gas: BigInt(forwardRequest.gas),
      deadline: BigInt(forwardRequest.deadline),
      data: forwardRequest.data,
      signature: signature,
    };

    // Encode the execute() call
    const calldata = forwarderInterface.encodeFunctionData("execute", [
      requestData,
    ]);

    return calldata;
  }

  /**
   * Poll OZ Relayer for transaction status until mined/failed
   * Waits for the transaction to be confirmed with an actual hash
   *
   * @param ozTxId - OZ Relayer's transaction ID
   * @param maxAttempts - Maximum polling attempts (from config or default: 30)
   * @param delayMs - Delay between attempts in ms (from config or default: 500)
   * @returns Transaction status with hash
   */
  private async pollForConfirmation(
    ozTxId: string,
    maxAttempts?: number,
    delayMs?: number,
  ): Promise<any> {
    // Use config values if not explicitly provided
    const pollingConfig = this.configService.get<{
      maxAttempts: number;
      delayMs: number;
    }>("relayer.polling");
    const actualMaxAttempts = maxAttempts ?? pollingConfig?.maxAttempts ?? 30;
    const actualDelayMs = delayMs ?? pollingConfig?.delayMs ?? 500;
    const relayerId = await this.getRelayerId();
    const endpoint = `${this.baseUrl}/api/v1/relayers/${relayerId}/transactions/${ozTxId}`;

    for (let attempt = 0; attempt < actualMaxAttempts; attempt++) {
      try {
        const response = await axios.get(endpoint, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        });

        const txData = response.data.data || response.data;
        const status = txData.status?.toLowerCase();

        // Check if transaction reached terminal state
        if (["mined", "confirmed", "failed", "reverted"].includes(status)) {
          this.logger.log(
            `Transaction ${ozTxId} reached terminal status: ${status}, hash: ${txData.hash}`,
          );
          return {
            transactionId: txData.id,
            txHash: txData.hash,
            status: txData.status,
            createdAt: txData.created_at,
          };
        }

        // Log progress every 5 attempts
        if (attempt % 5 === 0) {
          this.logger.debug(
            `Polling OZ Relayer [${attempt + 1}/${actualMaxAttempts}]: ${ozTxId} status=${status}`,
          );
        }
      } catch (error) {
        const axiosError = error as AxiosError;
        this.logger.warn(
          `Poll attempt ${attempt + 1} failed: ${axiosError.message}`,
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, actualDelayMs));
    }

    // Return last known state if max attempts reached
    this.logger.warn(`Max polling attempts reached for ${ozTxId}`);
    throw new Error(
      `Transaction ${ozTxId} did not reach terminal status after ${actualMaxAttempts} attempts`,
    );
  }

  /**
   * Invalidate cached relayer ID on specific errors
   * Called when API returns 404, indicating relayer may have been redeployed
   */
  private invalidateRelayerIdCache(error: AxiosError): void {
    if (error.response?.status === 404) {
      this.logger.warn(
        "Received 404 error - invalidating cached relayer ID (relayer may have been redeployed)",
      );
      this.relayerId = null;
    }
  }

  /**
   * Send direct transaction to OZ Relayer and wait for confirmation
   */
  async sendDirectTransaction(request: {
    to: string;
    data: string;
    value?: string;
    gasLimit?: string;
    speed?: string;
  }): Promise<any> {
    try {
      const relayerId = await this.getRelayerId();
      const endpoint = `${this.baseUrl}/api/v1/relayers/${relayerId}/transactions`;

      this.logger.debug(`Sending direct TX to OZ Relayer: ${endpoint}`);

      const ozRequest = {
        to: request.to,
        data: request.data,
        value: request.value ? parseInt(request.value, 10) : 0,
        gas_limit: request.gasLimit ? parseInt(request.gasLimit, 10) : 100000,
        speed: request.speed || "average",
      };

      const response = await axios.post(endpoint, ozRequest, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 30000,
      });

      const txData = response.data.data;
      const ozTxId = txData.id;

      this.logger.log(`Direct TX submitted to OZ Relayer: ${ozTxId}`);

      // Poll until confirmed with hash (Hardhat mines immediately)
      return await this.pollForConfirmation(ozTxId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.invalidateRelayerIdCache(error);
      }
      throw error;
    }
  }

  /**
   * Send gasless transaction to OZ Relayer via Forwarder.execute() and wait for confirmation
   */
  async sendGaslessTransaction(
    request: {
      request: {
        from: string;
        to: string;
        value: string;
        gas: string;
        nonce: string;
        deadline: string;
        data: string;
      };
      signature: string;
    },
    forwarderAddress: string,
  ): Promise<any> {
    try {
      const relayerId = await this.getRelayerId();
      const endpoint = `${this.baseUrl}/api/v1/relayers/${relayerId}/transactions`;

      this.logger.debug(`Sending gasless TX to OZ Relayer: ${endpoint}`);
      this.logger.debug(`Forwarder address: ${forwarderAddress}`);

      // Build the execute() calldata
      const executeCalldata = this.buildForwarderExecuteCalldata(
        request.request,
        request.signature,
      );

      // Calculate gas limit for forwarder call (inner gas + overhead)
      const innerGas = BigInt(request.request.gas);
      const forwarderOverhead = BigInt(50000); // Forwarder execution overhead
      const totalGas = innerGas + forwarderOverhead;

      const ozRequest = {
        to: forwarderAddress,
        data: executeCalldata,
        value: parseInt(request.request.value, 10),
        gas_limit: Number(totalGas),
        speed: "average",
      };

      const response = await axios.post(endpoint, ozRequest, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 30000,
      });

      const txData = response.data.data;
      const ozTxId = txData.id;

      this.logger.log(`Gasless TX submitted to OZ Relayer: ${ozTxId}`);

      // Poll until confirmed with hash (Hardhat mines immediately)
      return await this.pollForConfirmation(ozTxId);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.invalidateRelayerIdCache(error);
      }
      throw error;
    }
  }

  /**
   * Send transaction to OZ Relayer (legacy method for compatibility)
   * Routes to appropriate handler based on message structure
   */
  async sendToOzRelayer(requestBody: any): Promise<any> {
    try {
      // Direct transaction: has top-level 'to' and 'data'
      if (requestBody.to && requestBody.data) {
        return await this.sendDirectTransaction(requestBody);
      }

      // If neither pattern matches, attempt direct transaction
      this.logger.warn("Unknown request format, attempting direct transaction");
      return await this.sendDirectTransaction(requestBody);
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `OZ Relayer request failed: ${axiosError.message}`,
        axiosError.response?.data,
      );
      throw error;
    }
  }

  /**
   * Poll for an existing OZ Relayer transaction (for recovery/retry scenarios)
   *
   * SPEC-QUEUE-001: Race condition prevention
   * When a message is reprocessed and ozRelayerTxId exists in DB,
   * this method polls for the existing transaction status instead of re-submitting.
   *
   * @param ozTxId - OZ Relayer's internal transaction ID
   * @returns Transaction status with hash
   */
  async pollExistingTransaction(ozTxId: string): Promise<any> {
    this.logger.log(`Polling existing OZ Relayer transaction: ${ozTxId}`);
    return await this.pollForConfirmation(ozTxId);
  }

  /**
   * SPEC-ROUTING-001 FR-002: Fire-and-Forget Direct Transaction
   *
   * Sends transaction to OZ Relayer and returns immediately after submission.
   * No polling - Webhook handles status updates.
   *
   * @param request - Direct transaction request
   * @param relayerUrl - Target relayer URL (from Smart Routing)
   * @param providedRelayerId - Optional relayer ID (if already known, skips API call)
   * @returns OZ Relayer's transaction ID (for tracking)
   */
  async sendDirectTransactionAsync(
    request: {
      to: string;
      data: string;
      value?: string;
      gasLimit?: string;
      speed?: string;
    },
    relayerUrl: string,
    providedRelayerId?: string,
  ): Promise<{ transactionId: string; relayerUrl: string }> {
    try {
      // Use provided relayerId or fetch from API
      const relayerId =
        providedRelayerId || (await this.getRelayerIdFromUrl(relayerUrl));
      const endpoint = `${relayerUrl}/api/v1/relayers/${relayerId}/transactions`;

      this.logger.debug(`[Fire-and-Forget] Sending direct TX to: ${endpoint}`);

      const ozRequest = {
        to: request.to,
        data: request.data,
        value: request.value ? parseInt(request.value, 10) : 0,
        gas_limit: request.gasLimit ? parseInt(request.gasLimit, 10) : 100000,
        speed: request.speed || "average",
      };

      const response = await axios.post(endpoint, ozRequest, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 30000,
      });

      const txData = response.data.data;
      const ozTxId = txData.id;

      this.logger.log(
        `[Fire-and-Forget] Direct TX submitted: ${ozTxId} (no polling)`,
      );

      // FR-002: Return immediately, no polling
      return {
        transactionId: ozTxId,
        relayerUrl,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.invalidateRelayerIdCache(error);
      }
      throw error;
    }
  }

  /**
   * SPEC-ROUTING-001 FR-002: Fire-and-Forget Gasless Transaction
   *
   * Sends gasless transaction via Forwarder.execute() and returns immediately.
   * No polling - Webhook handles status updates.
   *
   * @param request - Gasless transaction request
   * @param forwarderAddress - ERC2771Forwarder contract address
   * @param relayerUrl - Target relayer URL (from Smart Routing)
   * @param providedRelayerId - Optional relayer ID (if already known, skips API call)
   * @returns OZ Relayer's transaction ID (for tracking)
   */
  async sendGaslessTransactionAsync(
    request: {
      request: {
        from: string;
        to: string;
        value: string;
        gas: string;
        nonce: string;
        deadline: string;
        data: string;
      };
      signature: string;
    },
    forwarderAddress: string,
    relayerUrl: string,
    providedRelayerId?: string,
  ): Promise<{ transactionId: string; relayerUrl: string }> {
    try {
      // Use provided relayerId or fetch from API
      const relayerId =
        providedRelayerId || (await this.getRelayerIdFromUrl(relayerUrl));
      const endpoint = `${relayerUrl}/api/v1/relayers/${relayerId}/transactions`;

      this.logger.debug(`[Fire-and-Forget] Sending gasless TX to: ${endpoint}`);
      this.logger.debug(`Forwarder address: ${forwarderAddress}`);

      // Build the execute() calldata
      const executeCalldata = this.buildForwarderExecuteCalldata(
        request.request,
        request.signature,
      );

      // Calculate gas limit for forwarder call (inner gas + overhead)
      const innerGas = BigInt(request.request.gas);
      const forwarderOverhead = BigInt(50000); // Forwarder execution overhead
      const totalGas = innerGas + forwarderOverhead;

      const ozRequest = {
        to: forwarderAddress,
        data: executeCalldata,
        value: parseInt(request.request.value, 10),
        gas_limit: Number(totalGas),
        speed: "average",
      };

      const response = await axios.post(endpoint, ozRequest, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 30000,
      });

      const txData = response.data.data;
      const ozTxId = txData.id;

      this.logger.log(
        `[Fire-and-Forget] Gasless TX submitted: ${ozTxId} (no polling)`,
      );

      // FR-002: Return immediately, no polling
      return {
        transactionId: ozTxId,
        relayerUrl,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.invalidateRelayerIdCache(error);
      }
      throw error;
    }
  }

  /**
   * Get relayer ID from a specific relayer URL
   * Used by Fire-and-Forget methods with Smart Routing
   */
  private async getRelayerIdFromUrl(relayerUrl: string): Promise<string> {
    try {
      this.logger.debug(
        `Fetching relayer ID from: ${relayerUrl}/api/v1/relayers`,
      );

      const response = await axios.get<{ data: Array<{ id: string }> }>(
        `${relayerUrl}/api/v1/relayers`,
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 10000,
        },
      );

      if (response.data?.data?.[0]?.id) {
        return response.data.data[0].id;
      }

      throw new Error("No relayer found in response");
    } catch (error) {
      const axiosError = error as AxiosError;
      this.logger.error(
        `Failed to discover relayer ID from ${relayerUrl}: ${axiosError.message}`,
      );
      throw new Error(`Failed to discover OZ Relayer ID from ${relayerUrl}`);
    }
  }
}
