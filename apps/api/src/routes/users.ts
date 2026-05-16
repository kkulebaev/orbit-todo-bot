import { Router } from "express";
import { toUserDto } from "../mappers/dto.js";

/**
 * `/v1/users` routes.
 *
 * - GET /me — return the resolved viewer as UserDto. Upsert happens in the
 *   `resolveViewer` middleware (AC-3), so by the time we reach the handler
 *   `req.viewer` is guaranteed.
 */
export function usersRoutes(): Router {
  const r = Router();
  r.get("/me", (req, res) => {
    res.json(toUserDto(req.viewer!));
  });
  return r;
}
