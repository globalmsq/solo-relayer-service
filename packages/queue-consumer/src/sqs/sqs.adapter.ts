import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
  MessageSystemAttributeName,
} from "@aws-sdk/client-sqs";

@Injectable()
export class SqsAdapter {
  private readonly logger = new Logger(SqsAdapter.name);
  private client!: SQSClient;

  constructor(private configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient() {
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
  }

  /**
   * Receive messages from SQS queue
   *
   * SPEC-DLQ-001: Added optional queueUrl parameter to support both main queue and DLQ
   *
   * @param waitTimeSeconds - Long polling wait time (default: 20)
   * @param maxNumberOfMessages - Max messages per poll (default: 10)
   * @param queueUrl - Optional queue URL (default: main queue from config)
   */
  async receiveMessages(
    waitTimeSeconds: number = 20,
    maxNumberOfMessages: number = 10,
    queueUrl?: string,
  ): Promise<Message[]> {
    const targetQueueUrl =
      queueUrl || this.configService.get<string>("sqs.queueUrl");

    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: targetQueueUrl,
        MaxNumberOfMessages: maxNumberOfMessages,
        WaitTimeSeconds: waitTimeSeconds,
        MessageSystemAttributeNames: [
          MessageSystemAttributeName.ApproximateReceiveCount,
          MessageSystemAttributeName.SentTimestamp,
        ],
      });

      const response = await this.client.send(command);
      return response.Messages || [];
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to receive messages: ${err.message}`,
        err.stack,
      );
      throw error;
    }
  }

  /**
   * Delete message from SQS queue
   *
   * SPEC-DLQ-001: Added optional queueUrl parameter to support both main queue and DLQ
   * U-2: MUST delete messages from SQS after processing DLQ messages
   *
   * @param receiptHandle - Receipt handle of the message to delete
   * @param queueUrl - Optional queue URL (default: main queue from config)
   */
  async deleteMessage(receiptHandle: string, queueUrl?: string): Promise<void> {
    const targetQueueUrl =
      queueUrl || this.configService.get<string>("sqs.queueUrl");

    try {
      const command = new DeleteMessageCommand({
        QueueUrl: targetQueueUrl,
        ReceiptHandle: receiptHandle,
      });

      await this.client.send(command);
      this.logger.debug(`Message deleted: ${receiptHandle}`);
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Failed to delete message: ${err.message}`, err.stack);
      throw error;
    }
  }
}
