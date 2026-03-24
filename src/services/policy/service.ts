import type { AppConfig } from "../../core/config.js";
import type { IngressMessage } from "../../core/types.js";
import type { RoleService } from "../roles/interface.js";
import type { ConfigService } from "../config/interface.js";
import type { MuteService } from "../mutes/interface.js";
import { RateLimiter } from "../../core/runtime/rate-limiter.js";
import type { PolicyResult, PolicyService } from "./interface.js";

export function createPolicyService(
  appConfig: AppConfig,
  roles: RoleService,
  config: ConfigService,
  mutes: MuteService,
  rateLimiter?: RateLimiter,
): PolicyService {
  return {
    evaluate(message: IngressMessage): PolicyResult {
      const text = message.text.trim();
      if (!text) return { action: "ignore" };

      const role = roles.resolveRole(message.callerId);

      // Permission check
      const promptPerm = message.isDM ? "prompt.dm" : "prompt.group";
      if (!roles.hasPermission(role, promptPerm)) {
        return {
          action: "deny",
          reason: message.isDM
            ? "You don't have permission to DM the agent."
            : "You don't have permission to use the agent.",
        };
      }

      // Mute check
      if (mutes.isMuted(message.callerId)) {
        return { action: "ignore" };
      }

      // Rate limit check
      if (rateLimiter) {
        const rateLimitOverride = config.get("rate_limit");
        const effectiveLimit = rateLimitOverride
          ? Number.parseInt(rateLimitOverride, 10)
          : appConfig.rateLimitPerUser;

        if (effectiveLimit > 0 && !rateLimiter.isAllowed(message.callerId, effectiveLimit)) {
          return { action: "deny", reason: "Rate limit exceeded. Try again shortly." };
        }
      }

      return { action: "process", prompt: text, callerId: message.callerId, role };
    },
  };
}
