import type {
  ElicitationHint,
  LocationSummary,
  ToolGuidance,
  ToolResultEnvelope
} from "./types";
import {
  guidanceInstructions,
  toolNames as canonicalToolNames
} from "./ai-instructions";

export interface FlowToolNames {
  listLocations: string;
  listDevices: string;
  inspectCapabilityContext: string;
  searchRuleReferences: string;
  getRuleReference: string;
  checkRuleJsonReferences: string;
}

export interface ToolResultParts {
  text: string;
  guidance?: ToolGuidance;
}

export function toolResult<TStructured extends Record<string, unknown>>(
  text: string,
  structuredContent: TStructured
): ToolResultEnvelope<TStructured> {
  return {
    content: [{ type: "text", text }],
    structuredContent
  };
}

export function disconnectedResultParts(
  reconnectUrl: string
): ToolResultParts {
  return {
    text:
      "SmartThings 연결이 필요합니다. 웹앱에서 PAT를 먼저 연결한 뒤 다시 요청해 주세요.",
    guidance: {
      instructions: [...guidanceInstructions.disconnected],
      next: {
        step: "reconnect",
        reason: "SmartThings connection is missing or expired."
      },
      elicitation: {
        message:
          "SmartThings 연결이 필요합니다. 웹앱에서 연결한 뒤 다시 요청해 주세요.",
        requestedSchema: {
          type: "object",
          properties: {
            reconnectUrl: {
              type: "string",
              const: reconnectUrl
            }
          },
          required: ["reconnectUrl"]
        }
      }
    }
  };
}

export function connectedStatusResultParts(
  toolNames: FlowToolNames
): ToolResultParts {
  return {
    text:
      "SmartThings 연결이 활성 상태입니다. 다음으로 위치 목록을 조회하세요.",
    guidance: {
      instructions: [...guidanceInstructions.connectedStatus],
      next: {
        step: "list_locations",
        tool: toolNames.listLocations,
        reason: "Choose the SmartThings location before listing devices."
      }
    }
  };
}

export function locationResultParts(
  locations: LocationSummary[],
  toolNames: FlowToolNames
): ToolResultParts {
  if (locations.length === 0) {
    return {
      text:
        "SmartThings 위치를 찾지 못했습니다. PAT 권한이나 계정 위치 설정을 확인해야 합니다.",
      guidance: {
        instructions: [...guidanceInstructions.noLocations],
        elicitation: {
          message:
            "SmartThings 위치를 찾지 못했습니다. PAT의 Locations 읽기 권한과 계정의 위치 설정을 확인해 주세요.",
          requestedSchema: {
            type: "object",
            properties: {
              checkedPermissions: {
                type: "boolean"
              }
            },
            required: ["checkedPermissions"]
          }
        }
      }
    };
  }

  if (locations.length === 1) {
    const [location] = locations;
    return {
      text: `${location.name} 위치를 찾았습니다. 이 위치의 기기 목록을 조회하세요.`,
      guidance: {
        instructions: [...guidanceInstructions.oneLocation],
        next: {
          step: "list_devices",
          tool: toolNames.listDevices,
          arguments: { locationId: location.locationId },
          reason: "Only one SmartThings location is available."
        }
      }
    };
  }

  return {
    text:
      `${locations.length}개 위치를 찾았습니다. Rule을 만들 위치를 사용자에게 먼저 선택받으세요.`,
    guidance: {
      instructions: [...guidanceInstructions.multipleLocations],
      next: {
        step: "choose_location",
        reason: "The user has multiple SmartThings locations."
      },
      elicitation: locationChoiceElicitation(locations)
    }
  };
}

export function deviceListResultParts(toolNames: FlowToolNames): ToolResultParts {
  return {
    text:
      "기기 목록을 찾았습니다. Rule JSON을 작성하기 전에 대상 device/component/capability와 trigger/action을 사용자에게 확인하세요.",
    guidance: {
      instructions: [...guidanceInstructions.deviceList],
      next: {
        step: "confirm_rule_targets",
        reason:
          "The user must confirm the selected device, component, capability, and trigger/action; then the model must search and fetch a Rule reference before drafting Rule JSON."
      }
    }
  };
}

export function deviceListContinuationResultParts(
  toolNames: FlowToolNames,
  locationId: string | undefined,
  nextCursor: number
): ToolResultParts {
  return {
    text: "기기 목록의 다음 페이지가 있습니다. 중간 결과를 설명하지 말고 계속 조회하세요.",
    guidance: {
      instructions: [...guidanceInstructions.deviceListContinuation],
      next: {
        step: "list_devices",
        tool: toolNames.listDevices,
        arguments: {
          ...(locationId ? { locationId } : {}),
          cursor: nextCursor
        },
        reason:
          "The GPT Actions device list is paginated; continue automatically before responding to the user."
      }
    }
  };
}

export function capabilityContextResultParts(toolNames: FlowToolNames): ToolResultParts {
  return {
    text:
      "Capability context를 조회했습니다. 반환된 schema/status와 요청 시 presentation을 읽고 Rule JSON 값을 결정하세요.",
    guidance: {
      instructions: [...guidanceInstructions.capabilityContext],
      next: {
        step: "search_rule_references",
        tool: toolNames.searchRuleReferences,
        reason:
          "Capability context was inspected; use Rule examples before drafting Rule JSON."
      }
    }
  };
}

export function rulesListResultParts(): ToolResultParts {
  return {
    text: "기존 Rule 목록을 찾았습니다. 이 결과는 읽기 전용 참고 정보입니다.",
    guidance: {
      instructions: [...guidanceInstructions.rulesList]
    }
  };
}

export function ruleDetailResultParts(ruleName: string): ToolResultParts {
  return {
    text: `${ruleName} Rule 상세를 조회했습니다. 이 결과는 읽기 전용 참고 정보입니다.`,
    guidance: {
      instructions: [...guidanceInstructions.ruleDetail]
    }
  };
}

export function ruleReferenceSearchResultParts(): ToolResultParts {
  return {
    text:
      "Rule 예시 참조를 찾았습니다. 확인된 위치와 기기 정보를 사용해 Rule JSON 초안을 작성하세요.",
    guidance: {
      instructions: [...guidanceInstructions.referenceSearch],
      next: {
        step: "get_rule_reference",
        tool: canonicalToolNames.getRuleReference,
        reason: "Read the selected reference detail and mapping notes before using the example."
      }
    }
  };
}

export function ruleReferenceDetailResultParts(): ToolResultParts {
  return {
    text:
      "Rule 예시 상세를 조회했습니다. placeholder를 확인된 ID로 바꾼 뒤 참조 점검을 호출하세요.",
    guidance: {
      instructions: [...guidanceInstructions.referenceDetail],
      next: {
        step: "draft_rule_json",
        reason: "The reference example must be mapped to the user's confirmed devices."
      }
    }
  };
}

export function referenceCheckResultParts(
  referencesOk: boolean,
  toolNames: FlowToolNames
): ToolResultParts {
  if (referencesOk) {
    return {
      text:
        "Rule JSON의 location/device/component/capability 참조 1차 점검을 통과했습니다. 아직 SmartThings Rule은 생성되지 않았습니다.",
      guidance: {
        instructions: [...guidanceInstructions.referenceCheckPassed],
        next: {
          step: "show_checked_draft",
          reason: "The drafted JSON passed the local reference integrity check."
        }
      }
    };
  }

  return {
    text:
      "Rule JSON에서 현재 SmartThings 연결 정보와 맞지 않는 참조 오류를 찾았습니다.",
    guidance: {
      instructions: [...guidanceInstructions.referenceCheckFailed],
      next: {
        step: "draft_rule_json",
        tool: toolNames.checkRuleJsonReferences,
        reason: "The drafted JSON must be corrected and checked again."
      }
    }
  };
}

export function createRuleExecutionResultParts(
  executionStatus: string
): ToolResultParts {
  if (executionStatus === "created") {
    return {
      text: "Rule을 생성했고 같은 PAT로 재조회했습니다."
    };
  }

  if (executionStatus === "create_not_confirmed") {
    return {
      text: "Rule 생성 요청은 처리됐지만 같은 PAT 재조회로 결과를 확인하지 못했습니다. 성공이라고 단정하지 마세요."
    };
  }

  if (executionStatus === "duplicate_name") {
    return {
      text: "같은 이름의 Rule이 이미 있어 생성하지 않았습니다."
    };
  }

  return {
    text:
      "SmartThings가 Rule 생성을 거부했습니다. 요청과 원문 응답을 확인하세요."
  };
}

export function updateRuleExecutionResultParts(
  executionStatus: string
): ToolResultParts {
  if (executionStatus === "updated") {
    return {
      text: "Rule을 수정했고 같은 PAT로 재조회했습니다."
    };
  }

  if (executionStatus === "update_not_confirmed") {
    return {
      text: "Rule 수정 요청은 처리됐지만 같은 PAT 재조회로 최종 내용을 확인하지 못했습니다. 성공이라고 단정하지 마세요."
    };
  }

  return {
    text:
      "SmartThings가 Rule 수정을 거부했습니다. 요청과 원문 응답을 확인하세요."
  };
}

export function deleteRuleExecutionResultParts(
  executionStatus: string
): ToolResultParts {
  if (executionStatus === "deleted") {
    return {
      text: "Rule을 삭제했고 같은 PAT 상세 재조회에서 대상이 없음을 확인했습니다."
    };
  }

  if (executionStatus === "delete_not_confirmed") {
    return {
      text:
        "Rule 삭제 요청 후 같은 PAT 상세 재조회로 삭제를 확인하지 못했습니다. 성공이라고 단정하지 마세요."
    };
  }

  return {
    text:
      "SmartThings가 Rule 삭제 요청을 거부했습니다. 응답 내용과 같은 PAT 재조회 결과를 확인하세요."
  };
}

export function setRuleStatusExecutionResultParts(
  executionStatus: string
): ToolResultParts {
  if (executionStatus === "enabled") {
    return {
      text: "Rule을 활성화했고 같은 PAT로 재조회해 활성 상태를 확인했습니다."
    };
  }

  if (executionStatus === "disabled") {
    return {
      text: "Rule을 비활성화했고 같은 PAT로 재조회해 비활성 상태를 확인했습니다."
    };
  }

  if (executionStatus === "already_enabled") {
    return {
      text:
        "이 Rule은 이미 활성 상태라 SmartThings 상태 변경 요청을 보내지 않았습니다."
    };
  }

  if (executionStatus === "already_disabled") {
    return {
      text:
        "이 Rule은 이미 비활성 상태라 SmartThings 상태 변경 요청을 보내지 않았습니다."
    };
  }

  if (executionStatus === "status_not_confirmed") {
    return {
      text:
        "상태 변경 요청은 성공했지만 same-PAT readback으로 목표 상태를 확인하지 못했습니다. 성공이라고 단정하지 마세요."
    };
  }

  return {
    text:
      "SmartThings가 Rule 상태 변경 요청을 거부했습니다. 원문 응답과 재조회 결과를 확인하세요."
  };
}

function locationChoiceElicitation(locations: LocationSummary[]): ElicitationHint {
  return {
    message: "어느 SmartThings 위치에서 Rule을 만들까요?",
    requestedSchema: {
      type: "object",
      properties: {
        locationId: {
          type: "string",
          enum: locations.map((location) => location.locationId),
          enumNames: locations.map((location) => location.name)
        }
      },
      required: ["locationId"]
    }
  };
}
