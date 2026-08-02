export type AppErrorCode =
  | "INVALID_REQUEST"
  | "MISSING_SESSION"
  | "SMARTTHINGS_PAT_EXPIRED"
  | "SMARTTHINGS_AUTH_FAILED"
  | "SMARTTHINGS_PERMISSION_DENIED"
  | "SMARTTHINGS_RATE_LIMITED"
  | "SMARTTHINGS_API_ERROR"
  | "RATE_LIMITED"
  | "PAYLOAD_TOO_LARGE"
  | "TOKEN_CRYPTO_ERROR"
  | "CONFIGURATION_ERROR"
  | "NOT_FOUND";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly messageForUser: string;

  constructor(code: AppErrorCode, status: number, messageForUser: string) {
    super(messageForUser);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.messageForUser = messageForUser;
  }
}

export function toErrorBody(error: unknown, reconnectUrl?: string) {
  if (error instanceof AppError) {
    const messageForUser =
      reconnectUrl && error.code === "SMARTTHINGS_PAT_EXPIRED"
        ? reconnectMessage(error.messageForUser, reconnectUrl)
        : error.messageForUser;

    return {
      ok: false as const,
      code: error.code,
      messageForUser,
      ...(reconnectUrl && error.code === "SMARTTHINGS_PAT_EXPIRED"
        ? { reconnectUrl }
        : {})
    };
  }

  return {
    ok: false as const,
    code: "SMARTTHINGS_API_ERROR" as const,
    messageForUser: "요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."
  };
}

function reconnectMessage(messageForUser: string, reconnectUrl: string): string {
  if (messageForUser.includes(reconnectUrl)) {
    return messageForUser;
  }

  const baseMessage =
    messageForUser.replace("웹앱에서 PAT를 다시 연결하세요.", "").trim() ||
    "SmartThings 연결이 만료되었습니다.";
  return `${baseMessage} 아래 링크에서 PAT를 다시 연결하세요: ${reconnectUrl}`;
}

export function mapSmartThingsStatus(status: number): AppError {
  if (status === 401) {
    return new AppError(
      "SMARTTHINGS_AUTH_FAILED",
      401,
      "SmartThings PAT가 만료되었거나 유효하지 않습니다. 새 PAT로 다시 연결하세요."
    );
  }

  if (status === 403) {
    return new AppError(
      "SMARTTHINGS_PERMISSION_DENIED",
      403,
      "PAT 권한이 부족합니다. Locations, Devices, Rules 권한을 포함해 다시 발급하세요."
    );
  }

  if (status === 429) {
    return new AppError(
      "SMARTTHINGS_RATE_LIMITED",
      429,
      "SmartThings API 요청이 너무 많습니다. 잠시 후 다시 시도하세요."
    );
  }

  return new AppError(
    "SMARTTHINGS_API_ERROR",
    status >= 400 && status < 600 ? status : 502,
    "SmartThings API 요청이 실패했습니다."
  );
}
