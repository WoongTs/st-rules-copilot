import { z } from "zod";

type UnknownRecord = Record<string, unknown>;

export const inspectCapabilityContextInputSchema = z.object({
  locationId: z.string().trim().min(1),
  targets: z
    .array(
      z.object({
        deviceId: z.string().trim().min(1),
        componentId: z.string().trim().min(1),
        capabilityId: z.string().trim().min(1),
        capabilityVersion: z.number().int().positive().optional()
      })
    )
    .min(1)
    .max(10),
  include: z
    .object({
      definition: z.boolean().optional(),
      deviceStatus: z.boolean().optional(),
      presentation: z.boolean().optional()
    })
    .optional(),
  presentationMode: z.enum(["none", "automationOnly"]).optional()
});

export type InspectCapabilityContextInput = z.infer<
  typeof inspectCapabilityContextInputSchema
>;

export type CapabilityPresentationMode = "none" | "automationOnly";

export interface CapabilityContextOptions {
  include: {
    definition: boolean;
    deviceStatus: boolean;
    presentation: boolean;
  };
  presentationMode: CapabilityPresentationMode;
}

export interface CapabilityContextWarning {
  code: string;
  message: string;
  path?: string;
}

export interface CapabilityContextResponse {
  messageForUser: string;
  contexts: CapabilityContext[];
}

export interface CapabilityContext {
  deviceId: string;
  deviceLabel?: string;
  componentId: string;
  capabilityId: string;
  capabilityVersion: number;
  definition: UnknownRecord | null;
  deviceStatus: UnknownRecord | null;
  presentation: UnknownRecord | null;
  normalized: NormalizedCapabilityContext;
  warnings: CapabilityContextWarning[];
}

export interface NormalizedCapabilityContext {
  attributeValueSchemas: AttributeValueSchema[];
  commandArgumentSchemas: CommandArgumentSchema[];
  statusValues: StatusValue[];
  presentationRefs: PresentationRef[];
}

export interface AttributeValueSchema {
  attribute: string;
  valueSchema: unknown;
  unitSchema: unknown | null;
  setter: string | null;
  enumCommands: string[];
  sourcePath: string;
}

export interface CommandArgumentSchema {
  command: string;
  arguments: CommandArgument[];
  sensitive: boolean;
  sourcePath: string;
}

export interface CommandArgument {
  name: string;
  optional: boolean;
  schema: unknown;
}

export interface StatusValue {
  attribute: string;
  kind: "array" | "object" | "scalar";
  value: unknown;
  timestamp?: string;
  sourcePath: string;
}

export interface PresentationRef {
  surface: "automation.actions" | "automation.conditions";
  label?: string;
  displayType?: string;
  command: string | null;
  value: unknown;
  supportedValues: string | null;
  alternatives: UnknownRecord[];
  sourcePath: string;
}

const MAX_PRESENTATION_ALTERNATIVES = 100;

export function capabilityContextOptions(
  input: InspectCapabilityContextInput
): CapabilityContextOptions {
  const include = {
    definition: input.include?.definition ?? true,
    deviceStatus: input.include?.deviceStatus ?? true,
    presentation: input.include?.presentation ?? false
  };
  const presentationMode =
    input.presentationMode ?? (include.presentation ? "automationOnly" : "none");

  if (presentationMode !== "none") {
    include.presentation = true;
  }

  return { include, presentationMode };
}

export function emptyNormalizedCapabilityContext(): NormalizedCapabilityContext {
  return {
    attributeValueSchemas: [],
    commandArgumentSchemas: [],
    statusValues: [],
    presentationRefs: []
  };
}

export function normalizeCapabilityContext(
  definition: UnknownRecord | null,
  deviceStatus: UnknownRecord | null,
  presentation: UnknownRecord | null
): { normalized: NormalizedCapabilityContext; warnings: CapabilityContextWarning[] } {
  const presentationExtraction = extractPresentationRefs(presentation);
  return {
    normalized: {
      attributeValueSchemas: extractAttributeValueSchemas(definition),
      commandArgumentSchemas: extractCommandArgumentSchemas(definition),
      statusValues: extractStatusValues(deviceStatus),
      presentationRefs: presentationExtraction.refs
    },
    warnings: presentationExtraction.warnings
  };
}

export function trimCapabilityPresentation(
  presentation: UnknownRecord,
  presentationMode: CapabilityPresentationMode
): UnknownRecord | null {
  if (presentationMode === "none") {
    return null;
  }

  const automation = isRecord(presentation.automation) ? presentation.automation : {};
  return {
    ...(stringValue(presentation.id) ? { id: presentation.id } : {}),
    ...(numberOrStringValue(presentation.version) ? { version: presentation.version } : {}),
    automation: {
      ...(Array.isArray(automation.conditions)
        ? { conditions: automation.conditions }
        : {}),
      ...(Array.isArray(automation.actions) ? { actions: automation.actions } : {})
    }
  };
}

export function extractAttributeValueSchemas(
  definition: UnknownRecord | null
): AttributeValueSchema[] {
  const attributes = isRecord(definition?.attributes) ? definition.attributes : {};

  return Object.entries(attributes).flatMap(([attribute, body]) => {
    if (!isRecord(body)) {
      return [];
    }

    const properties = isRecord(body.schema)
      ? isRecord(body.schema.properties)
        ? body.schema.properties
        : {}
      : {};

    return [
      {
        attribute,
        valueSchema: properties.value ?? null,
        unitSchema: properties.unit ?? null,
        setter: stringValue(body.setter) ?? null,
        enumCommands: stringArray(body.enumCommands),
        sourcePath: pathForKey("$.definition.attributes", attribute)
      }
    ];
  });
}

export function extractCommandArgumentSchemas(
  definition: UnknownRecord | null
): CommandArgumentSchema[] {
  const commands = isRecord(definition?.commands) ? definition.commands : {};

  return Object.entries(commands).flatMap(([command, body]) => {
    if (!isRecord(body)) {
      return [];
    }

    const args = Array.isArray(body.arguments) ? body.arguments : [];
    return [
      {
        command,
        arguments: args.flatMap((argument) => {
          if (!isRecord(argument)) {
            return [];
          }
          return [
            {
              name: stringValue(argument.name) ?? "",
              optional: argument.optional === true,
              schema: argument.schema ?? null
            }
          ];
        }),
        sensitive: body.sensitive === true,
        sourcePath: pathForKey("$.definition.commands", command)
      }
    ];
  });
}

export function extractStatusValues(deviceStatus: UnknownRecord | null): StatusValue[] {
  if (!deviceStatus) {
    return [];
  }

  return Object.entries(deviceStatus).flatMap(([attribute, body]) => {
    if (!isRecord(body) || !("value" in body)) {
      return [];
    }

    const value = body.value;
    return [
      {
        attribute,
        kind: Array.isArray(value) ? "array" : isRecord(value) ? "object" : "scalar",
        value,
        ...(stringValue(body.timestamp) ? { timestamp: stringValue(body.timestamp) } : {}),
        sourcePath: `${pathForKey("$.deviceStatus", attribute)}.value`
      }
    ];
  });
}

function extractPresentationRefs(
  presentation: UnknownRecord | null
): { refs: PresentationRef[]; warnings: CapabilityContextWarning[] } {
  if (!presentation) {
    return { refs: [], warnings: [] };
  }

  const automation = isRecord(presentation.automation) ? presentation.automation : {};
  const warnings: CapabilityContextWarning[] = [];
  const refs = [
    ...refsForSurface(automation.actions, "automation.actions", warnings),
    ...refsForSurface(automation.conditions, "automation.conditions", warnings)
  ];

  return { refs, warnings };
}

function refsForSurface(
  value: unknown,
  surface: "automation.actions" | "automation.conditions",
  warnings: CapabilityContextWarning[]
): PresentationRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      return [];
    }

    const sourcePath = `$.presentation.${surface}[${index}]`;
    const alternativesValue = findPresentationField(item, "alternatives");
    const alternatives = Array.isArray(alternativesValue)
      ? alternativesValue.filter(isRecord)
      : [];
    const truncated = alternatives.length > MAX_PRESENTATION_ALTERNATIVES;
    if (truncated) {
      warnings.push({
        code: "TRUNCATED",
        message:
          "Capability presentation alternatives were truncated to keep the response small.",
        path: sourcePath
      });
    }

    return [
      {
        surface,
        ...(stringValue(findPresentationField(item, "label"))
          ? { label: stringValue(findPresentationField(item, "label")) }
          : {}),
        ...(stringValue(findPresentationField(item, "displayType"))
          ? { displayType: stringValue(findPresentationField(item, "displayType")) }
          : {}),
        command: stringValue(findPresentationField(item, "command")) ?? null,
        value: findPresentationField(item, "value") ?? null,
        supportedValues:
          stringValue(findPresentationField(item, "supportedValues")) ?? null,
        alternatives: alternatives.slice(0, MAX_PRESENTATION_ALTERNATIVES),
        sourcePath
      }
    ];
  });
}

function findPresentationField(value: UnknownRecord, field: string): unknown {
  if (field in value) {
    return value[field];
  }

  const stack: Array<{ value: unknown; depth: number }> = Object.values(value).map(
    (child) => ({ value: child, depth: 1 })
  );

  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || current.depth > 4 || !isRecord(current.value)) {
      continue;
    }

    if (field in current.value) {
      return current.value[field];
    }

    for (const child of Object.values(current.value)) {
      if (isRecord(child)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }

  return undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberOrStringValue(value: unknown): number | string | undefined {
  if (typeof value === "number" || typeof value === "string") {
    return value;
  }

  return undefined;
}

function pathForKey(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}
