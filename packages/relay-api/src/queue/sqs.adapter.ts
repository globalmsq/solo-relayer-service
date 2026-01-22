import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

/**
 * SqsAdapter - AWS SQS Message Producer
 *
 * SPEC-QUEUE-001: AWS SQS Queue System - Producer Adapter
 *
 * Handles message sending to SQS with dual credential support:
 * - LocalStack: Uses explicit credentials (accessKeyId, secretAccessKey)
 * - Production: Uses IAM Instance Role (auto-loaded by AWS SDK)
 */
@Injectable()
export class SqsAdapter {
  private readonly logger = new Logger(SqsAdapter.name);
  private client!: SQSClient;
  private readonly queueUrl: string;

  constructor(private configService: ConfigService) {
    // Validate required environment variables (fail-fast)
    const queueUrl = this.configService.get<string>("sqs.queueUrl");
    const region = this.configService.get<string>("sqs.region");

    if (!queueUrl) {
      throw new Error("SQS_QUEUE_URL environment variable is required");
    }
    if (!region) {
      throw new Error("AWS_REGION environment variable is required");
    }

    this.queueUrl = queueUrl;
    this.initializeClient();
  }

  /**
   * Initialize SQS client with appropriate credentials
   *
   * LocalStack: Uses endpoint + explicit credentials
   * Production: Uses region only (IAM Role credentials auto-loaded)
   */
  private initializeClient(): void {
    const endpoint = this.configService.get<string>("sqs.endpoint");
    const region = this.configService.get<string>("sqs.region");
    const isLocal = !!endpoint;

    this.logger.log(
      `Initializing SQS Client (${isLocal ? "LocalStack" : "AWS"})`,
    );

    this.client = new SQSClient(
      isLocal
        ? {
            endpoint,
            region,
            credentials: {
              accessKeyId: this.configService.get("sqs.accessKeyId") || "test",
              secretAccessKey:
                this.configService.get("sqs.secretAccessKey") || "test",
            },
          }
        : {
            region,
            // Production: IAM Instance Role credentials auto-loaded
          },
    );

    this.logger.log(
      `SQS Client initialized: region=${region}, queueUrl=${this.queueUrl}`,
    );
  }

  /**
   * Send message to SQS queue
   *
   * @param messageBody - Object to be JSON-serialized and sent
   * @throws Error if SQS send fails
   */
  async sendMessage(messageBody: object): Promise<void> {
    try {
      const command = new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify(messageBody),
      });

      const result = await this.client.send(command);
      this.logger.debug(`Message sent to SQS: MessageId=${result.MessageId}`);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to send message to SQS: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }
}
