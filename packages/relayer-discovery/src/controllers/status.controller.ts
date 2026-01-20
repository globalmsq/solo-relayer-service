import { Controller, Get } from "@nestjs/common";
import { DiscoveryService } from "../services/discovery.service";
import { StatusResponse } from "../dto/status-response.dto";

@Controller()
export class StatusController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  @Get("/status")
  async getStatus(): Promise<StatusResponse> {
    return this.discoveryService.getStatus();
  }
}
