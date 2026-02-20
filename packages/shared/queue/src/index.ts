export const QUEUE_NAMES = {
  PROVISION_USER: "provision-user",
  SEND_WHATSAPP: "send-whatsapp",
  EMAIL_ACTIONABILITY: "email-actionability",
  TOOL_DISCOVERY: "tool-discovery",
  AUDIT_LOG_WRITER: "audit-log-writer",
  MEDIA_CLEANUP: "media-cleanup"
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
