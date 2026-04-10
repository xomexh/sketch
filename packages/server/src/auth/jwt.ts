/**
 * JWT signing and verification using jose (HS256).
 * Tokens are self-contained — no server-side session state needed.
 */
import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";
/** Session tokens expire after 7 days; users must log in again after expiry. */
const EXPIRY = "7d";

/** Converts a plain-text secret string to a Uint8Array key suitable for jose. */
function secretToKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * Issues a signed HS256 JWT containing the user's ID and role.
 * The token is valid for {@link EXPIRY} days and is verified client-side via cookie.
 */
export async function signJwt(sub: string, role: "admin" | "member", secret: string): Promise<string> {
  return new SignJWT({ sub, role })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(secretToKey(secret));
}

/**
 * Verifies an HS256 JWT and returns its claims, or `null` if the token is
 * invalid, expired, or tampered with.
 *
 * @remarks Role defaults to `"admin"` for tokens issued before the role claim
 * was introduced so that existing admin sessions are not broken on upgrade.
 */
export async function verifyJwt(
  token: string,
  secret: string,
): Promise<{ sub: string; role: "admin" | "member"; email?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretToKey(secret));
    if (typeof payload.sub !== "string") return null;
    const role = payload.role === "member" ? "member" : "admin";
    const result: { sub: string; role: "admin" | "member"; email?: string } = { sub: payload.sub, role };
    if (typeof payload.email === "string") {
      result.email = payload.email;
    }
    return result;
  } catch {
    return null;
  }
}
