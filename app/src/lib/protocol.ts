// The wire contract lives in ../shared/protocol.ts (types only). Re-exported here so the
// app imports it from one place. Type-only: nothing from outside app/ reaches the bundle.
export type {
  App,
  AppPreset,
  AppStatus,
  BuildInfo,
  ChatItem,
  ChatItemKind,
  CreateAppRequest,
  EasyConnectPairRequest,
  ErrorBody,
  HealthResponse,
  PairRequest,
  PairResponse,
  PermissionAnswerRequest,
  PermissionInfo,
  PlanEntry,
  SendMessageRequest,
  ServerEvent,
  ToolCallInfo,
} from "@shared/protocol";
