import { Injectable } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class OzRelayerService {
  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  // Phase 1: Stub methods only
  // Phase 2+: Actual OZ Relayer API calls

  async sendTransaction(txData: any): Promise<any> {
    // Stub: No actual implementation in Phase 1
    return {
      status: "stub",
      message: "Phase 2+ implementation",
      data: txData,
    };
  }

  async getRelayerStatus(): Promise<any> {
    // Stub: No actual implementation in Phase 1
    return {
      status: "stub",
      message: "Phase 2+ implementation",
    };
  }

  async queryTransaction(txHash: string): Promise<any> {
    // Stub: No actual implementation in Phase 1
    return {
      status: "stub",
      message: "Phase 2+ implementation",
      txHash,
    };
  }
}
