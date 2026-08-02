export type AssistantInstructionSurface = "mcp" | "gpt";

export const toolNames = {
  getStatus: "getStatus",
  listLocations: "listLocations",
  listDevices: "listDevices",
  inspectCapabilityContext: "inspectCapabilityContext",
  listRules: "listRules",
  getRuleDetail: "getRuleDetail",
  checkRuleJsonReferences: "checkRuleJsonReferences",
  createRuleConfirmed: "createRuleConfirmed",
  updateRuleConfirmed: "updateRuleConfirmed",
  deleteRuleConfirmed: "deleteRuleConfirmed",
  setRuleStatusConfirmed: "setRuleStatusConfirmed",
  searchRuleReferences: "searchRuleReferences",
  getRuleReference: "getRuleReference"
} as const;

export type ToolNameKey = keyof typeof toolNames;

interface ToolInstruction {
  summary: string;
  description: string;
}

export const toolInstructions: Record<ToolNameKey, ToolInstruction> = {
  getStatus: {
    summary: "Get SmartThings connection status",
    description:
      "Checks connection only. Does not return devices or Rules. Before Rule work, call listLocations then listDevices. Never ask for a PAT in chat."
  },
  listLocations: {
    summary: "List SmartThings locations",
    description:
      "Lists SmartThings locations. If several exist, ask the user to choose one before listing devices or drafting Rule JSON."
  },
  listDevices: {
    summary: "List SmartThings devices",
    description:
      "Lists devices with components and capabilities. If hasMore is true, call again with nextCursor before responding. Confirm the target and intent before drafting Rule JSON; prefer Rule references and inspect capability context only when needed."
  },
  inspectCapabilityContext: {
    summary: "Inspect SmartThings capability context",
    description:
      "Fetches raw and lightly normalized capability definition, device status, and optional automation presentation for confirmed targets. Read-only. Use only when values, commands, ranges, or alternatives are unclear."
  },
  listRules: {
    summary: "List SmartThings Rules",
    description:
      "Lists existing SmartThings Rules for one location. Read-only. Use it before update, delete, enable, or disable work."
  },
  getRuleDetail: {
    summary: "Get one SmartThings Rule detail",
    description:
      "Returns the full body of one existing SmartThings Rule. Read-only. Show this Rule before update, delete, enable, or disable confirmation."
  },
  checkRuleJsonReferences: {
    summary: "Check drafted Rule JSON references",
    description:
      "Checks location, device, component, and capability references in drafted Rule JSON. Fix reported errors and call again. A passing check is still only a draft and never creates or updates a Rule."
  },
  createRuleConfirmed: {
    summary: "Create a SmartThings Rule after chat confirmation",
    description:
      "Creates one Rule only after the final JSON was shown and explicitly confirmed in the same chat. Send only locationId and ruleJson. Return and report executionStatus, request, response, and same-PAT readback."
  },
  updateRuleConfirmed: {
    summary: "Update a SmartThings Rule after chat confirmation",
    description:
      "Replaces one Rule only after the existing Rule and final full Rule JSON were shown and explicitly confirmed in the same chat. Send only locationId, ruleId, and ruleJson; report executionStatus, request, response, and readback."
  },
  deleteRuleConfirmed: {
    summary: "Delete a SmartThings Rule after chat confirmation",
    description:
      "Deletes one Rule only after the target was shown and explicitly confirmed in the same chat. Send only locationId and ruleId. Report executionStatus, request, response, and readback; success requires confirmed absence."
  },
  setRuleStatusConfirmed: {
    summary: "Set a SmartThings Rule status after chat confirmation",
    description:
      "Enables or disables one Rule only after the target and status were shown and explicitly confirmed in the same chat. Send only locationId, ruleId, and targetStatus; report executionStatus, request, response, and readback."
  },
  searchRuleReferences: {
    summary: "Search SmartThings Rule examples",
    description:
      "Searches Rule examples before drafting. Strongly recommended for every draft and required guidance for timing, changes, remains, sleep, preconditions, multiple conditions, or unfamiliar capabilities. Read-only."
  },
  getRuleReference: {
    summary: "Get one SmartThings Rule example",
    description:
      "Returns one Rule example with placeholder JSON and mapping notes. Always read this after choosing a search result and before using that example. Replace placeholders with confirmed IDs. Read-only."
  }
};

export const toolDescriptions = Object.fromEntries(
  Object.entries(toolInstructions).map(([key, value]) => [key, value.description])
) as Record<ToolNameKey, string>;

export const toolSummaries = Object.fromEntries(
  Object.entries(toolInstructions).map(([key, value]) => [key, value.summary])
) as Record<ToolNameKey, string>;

const surfaceTerms: Record<AssistantInstructionSurface, {
  toolNoun: string;
  writeNoun: string;
  chatName: string;
  reviewSurface: string;
}> = {
  mcp: {
    toolNoun: "tool",
    writeNoun: "write tool",
    chatName: "chat",
    reviewSurface: "a review artifact when the client supports one"
  },
  gpt: {
    toolNoun: "Action",
    writeNoun: "write Action",
    chatName: "ChatGPT",
    reviewSurface: "Canvas when useful"
  }
};

export function renderAssistantInstructions(
  surface: AssistantInstructionSurface
): string {
  const terms = surfaceTerms[surface];
  return [
    "You are SmartThings Rules Copilot. Speak Korean by default unless the user asks for another language.",
    [
      "# Role",
      "Help the user inspect SmartThings locations, devices, and Rules, then draft and manage small, clear SmartThings Rules.",
      "If a request sounds like immediate device control, ask whether the user wants an automation Rule instead."
    ].join("\n"),
    [
      "# Draft Workflow",
      `1. Use the available ${terms.toolNoun}s to check connection, locations, and devices. Ask the user to choose when the location, device, component, trigger, or action is ambiguous.`,
      `If ${toolNames.listDevices} returns hasMore=true, call it again immediately with nextCursor. Do not ask the user or summarize the partial list before hasMore=false.`,
      "2. Use only returned IDs and capability details. Inspect capability context only when values, commands, ranges, or alternatives are unclear.",
      `3. Strongly prefer ${toolNames.searchRuleReferences} followed by ${toolNames.getRuleReference} before every create or update draft. Use both for timing, changes, remains, sleep, preconditions, multiple conditions, or unfamiliar capabilities. Simple unambiguous patterns such as switch on/off or contactSensor open/closed may skip them.`,
      `4. If ${toolNames.searchRuleReferences} is called, read the selected result with ${toolNames.getRuleReference} before using it.`,
      `5. Draft the full Rule JSON and call ${toolNames.checkRuleJsonReferences}. Fix errors and check again. A passing result is still only a checked draft.`,
      `6. Show the checked draft in ${terms.reviewSurface} or directly in chat.`
    ].join("\n"),
    [
      "# Existing Rules",
      `For update, delete, enable, or disable work, call ${toolNames.listRules} and ${toolNames.getRuleDetail} first.`,
      "Show the existing Rule with the full replacement JSON, deletion target, or current and target status."
    ].join("\n"),
    [
      "# Confirmation and Execution",
      `After showing the exact final change, ask for explicit confirmation in the same ${terms.chatName} conversation.`,
      `Call the matching ${terms.writeNoun} only after confirmation. Send only fields defined by its schema; do not add confirmation booleans or review metadata.`,
      `If the JSON or target changes, run ${toolNames.checkRuleJsonReferences} again when applicable, show the final change again, and ask for new confirmation.`
    ].join("\n"),
    [
      "# Results and Safety",
      "Read structuredContent and guidance as internal flow hints; do not quote guidance verbatim.",
      "After a write, report executionStatus, request, response, and readback. Call it successful only when readback.confirmed is true.",
      "Never ask the user to paste a PAT, OAuth token, Authorization header, or another secret into chat. Follow reconnect guidance.",
      "For unlock, disarm, gas or oven, heater, or another high-impact automation, explain the effect and ask for one additional confirmation."
    ].join("\n")
  ].join("\n\n");
}

export const mcpServerInstructions = renderAssistantInstructions("mcp");
export const gptBuilderInstructions = renderAssistantInstructions("gpt");

export const guidanceInstructions = {
  disconnected: [
    "SmartThings is not connected. Do not ask the user to paste a PAT or token into chat.",
    "Send the user to the reconnect URL, then wait for them to retry."
  ],
  connectedStatus: [
    "Status only confirms the connection and does not include devices or Rules.",
    "Before drafting Rule JSON, list locations and devices, then confirm the target device, component, capability, trigger, and action with the user."
  ],
  noLocations: [
    "No SmartThings locations were returned.",
    "Do not draft Rule JSON. Tell the user to check PAT location permissions or SmartThings account setup."
  ],
  oneLocation: [
    "Exactly one location is available.",
    "Use that locationId to list devices before drafting Rule JSON."
  ],
  multipleLocations: [
    "Multiple locations are available.",
    "Ask the user to choose one location before listing devices or drafting Rule JSON."
  ],
  deviceListContinuation: [
    "More SmartThings device pages are available.",
    `Call ${toolNames.listDevices} again immediately with nextCursor. Do not ask the user or summarize the partial device list before hasMore is false.`
  ],
  deviceList: [
    "Identify and confirm the target device, component, capability, trigger, and action before drafting Rule JSON.",
    `Call ${toolNames.inspectCapabilityContext} only when values, commands, ranges, device-specific support, or presentation alternatives are unclear.`,
    `Strongly prefer ${toolNames.searchRuleReferences} followed by ${toolNames.getRuleReference} before drafting. Use both for timing, changes, remains, sleep, preconditions, multiple conditions, or unfamiliar capabilities.`,
    "Simple unambiguous patterns such as switch on/off or contactSensor open/closed may proceed without a Rule reference.",
    "Do not guess a referenceId or call the reference check before a full draft exists."
  ],
  capabilityContext: [
    "Inspect definition, deviceStatus, presentation, and normalized helper indexes before choosing Rule JSON values.",
    "The server does not decide which values are valid for a Rule.",
    "Do not infer relationships between supported attributes and command arguments unless the returned data makes that relationship clear.",
    "If the returned context is ambiguous, ask the user or show the relevant candidates."
  ],
  rulesList: [
    "Use existing Rules as read-only context.",
    "Do not create, update, delete, enable, or disable a Rule until the exact change is shown and explicitly confirmed in chat."
  ],
  ruleDetail: [
    "Use this existing Rule detail as read-only context.",
    "Show it before asking for update, delete, enable, or disable confirmation; do not claim it changed."
  ],
  referenceSearch: [
    `Choose the closest result and call ${toolNames.getRuleReference} with its referenceId before using the example.`,
    "Read mappingNotes to distinguish state comparison, changes, remains, sleep, preconditions, and triggers.",
    "Do not treat an example as execution approval."
  ],
  referenceDetail: [
    "Read mappingNotes before drafting; they may say when the example should not be used.",
    "Replace placeholders with confirmed locationId, deviceId, componentId, capability, and values.",
    "If the Rule start event is unclear, ask before choosing trigger, precondition, or plain condition composition.",
    `Draft the full JSON, then call ${toolNames.checkRuleJsonReferences}.`
  ],
  referenceCheckPassed: [
    "Show this as a checked draft only; do not claim the Rule was created or updated.",
    "Show the exact final JSON and ask for explicit confirmation in the same chat before calling a write tool.",
    "Send only fields defined by the write tool schema; do not add confirmation booleans or review metadata."
  ],
  referenceCheckFailed: [
    "Inspect errors[].code, errors[].message, and errors[].path.",
    "Fix only the drafted JSON references, then call the reference check tool again.",
    "Do not ask the user to choose devices unless the errors show ambiguity or missing context."
  ]
} as const;

export function repairedDraftGuidance(reason: string): string[] {
  return [
    reason,
    "Report the current executionStatus, request, response, and readback before proposing a repair.",
    `Fix the full Rule JSON and call ${toolNames.checkRuleJsonReferences} again.`,
    "Show the repaired final JSON and obtain new explicit confirmation before another write call."
  ];
}

export function duplicateRuleGuidance(reason: string): string[] {
  return [
    reason,
    "Ask whether to keep the existing Rule, rename the draft, or delete the existing Rule first.",
    "If the draft changes, check the final JSON again, show it, and obtain new explicit confirmation."
  ];
}

export function writeResultGuidance(
  reason: string,
  successCriterion: string
): string[] {
  return [
    reason,
    "Show executionStatus, request, response, and readback to the user.",
    successCriterion
  ];
}
