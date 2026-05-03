import { randomUUID } from "node:crypto";

export class EngineerAuthService {
  private readonly tokens = new Set<string>();

  public constructor(private readonly password: string) {}

  public login(password: string): { ok: boolean; token?: string } {
    if (password !== this.password) {
      return { ok: false };
    }

    const token = randomUUID();
    this.tokens.add(token);
    return { ok: true, token };
  }

  public verify(token: string | undefined): boolean {
    if (!token) {
      return false;
    }
    return this.tokens.has(token);
  }
}
