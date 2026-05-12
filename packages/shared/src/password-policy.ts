export type PasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireDigit: boolean;
  requireSpecialChar: boolean;
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 3,
  requireUppercase: false,
  requireLowercase: false,
  requireDigit: false,
  requireSpecialChar: false,
};

export function normalizePasswordPolicy(input: Partial<PasswordPolicy> | null | undefined): PasswordPolicy {
  const minLengthValue = Number(input?.minLength);
  const minLength = Number.isFinite(minLengthValue) ? Math.max(3, Math.trunc(minLengthValue)) : DEFAULT_PASSWORD_POLICY.minLength;
  return {
    minLength,
    requireUppercase: Boolean(input?.requireUppercase),
    requireLowercase: Boolean(input?.requireLowercase),
    requireDigit: Boolean(input?.requireDigit),
    requireSpecialChar: Boolean(input?.requireSpecialChar),
  };
}

export function validatePasswordPolicy(
  password: string,
  policy: PasswordPolicy,
): string[] {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters long`);
  }

  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (policy.requireDigit && !/[0-9]/.test(password)) {
    errors.push("Password must contain at least one digit");
  }

  if (policy.requireSpecialChar && !/[!@#$%^&*()_+\-=[\]{};':\"\\|,.<>/?`~]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  return errors;
}

