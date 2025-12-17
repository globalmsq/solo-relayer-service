import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";

/**
 * API Key Authentication Guard
 *
 * Validates x-api-key header against RELAY_API_KEY environment variable.
 * Endpoints decorated with @Public() bypass authentication.
 *
 * @throws {Error} If RELAY_API_KEY is not configured at startup
 * @throws {UnauthorizedException} If API key is missing or invalid
 *
 * @example
 * // Apply globally via APP_GUARD in auth.module.ts
 * providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }]
 *
 * @example
 * // Bypass authentication with @Public() decorator
 * @Public()
 * @Get('health')
 * getHealth() { ... }
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>("apiKey");
    if (!apiKey) {
      throw new Error("RELAY_API_KEY environment variable is required");
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>("isPublic", [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers["x-api-key"];

    const configuredApiKey = this.configService.get<string>("apiKey");

    // Validate API key
    if (!apiKey || apiKey !== configuredApiKey) {
      throw new UnauthorizedException("Invalid API key");
    }

    return true;
  }
}
