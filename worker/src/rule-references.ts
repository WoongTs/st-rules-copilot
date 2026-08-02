export interface RuleReference {
  id: string;
  title: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  sourceExamplePath: string;
  patternKind: "official" | "derived";
  tags: string[];
  aliases: string[];
  constructs: string[];
  triggerCapabilities: string[];
  actionCapabilities: string[];
  conditions: string[];
  operands: string[];
  commands: string[];
  requiredContext: string[];
  mappingNotes: string[];
  example: Record<string, unknown>;
}

export interface RuleReferenceSearchFilters {
  query?: string;
  constructs?: string[];
  triggerCapabilities?: string[];
  actionCapabilities?: string[];
  conditions?: string[];
  operands?: string[];
  commands?: string[];
  tags?: string[];
  limit?: number;
}

export interface RuleReferenceSearchResult
  extends Omit<RuleReference, "example" | "mappingNotes"> {
  score: number;
  matchedFields: string[];
  matchReason: string;
}

const SMARTTHINGS_RULES_GUIDE =
  "https://developer.smartthings.com/docs/automations/rules";
const PROJECT_TEMPLATE_SOURCE =
  "Project-authored template (SmartThings Rules grammar)";

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 10;
const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "my",
  "of",
  "or",
  "our",
  "the",
  "then",
  "to",
  "when",
  "with"
]);

const QUERY_PHRASE_EXPANSIONS: readonly [string, readonly string[]][] = [
  ["turn on", ["on", "switch", "light"]],
  ["turn off", ["off", "switch", "light"]],
  ["turn the light red", ["color", "red", "setcolor", "hue", "saturation"]],
  ["make the light red", ["color", "red", "setcolor", "hue", "saturation"]],
  ["door opens", ["contact", "contactsensor", "open"]],
  ["window opens", ["contact", "contactsensor", "open"]],
  ["motion detected", ["motion", "motionsensor", "active"]],
  ["no motion", ["motion", "motionsensor", "inactive", "remains"]],
  ["after no motion", ["motion", "inactive", "remains", "timeout"]],
  ["at sunset", ["sunset", "time"]],
  ["sun sets", ["sunset", "time"]],
  ["scheduled time", ["schedule", "time", "daily"]],
  ["specific time", ["specific", "schedule", "time"]],
  ["at a specific time", ["specific", "schedule", "time"]],
  ["at a set time", ["specific", "schedule", "time"]],
  ["every day at", ["specific", "schedule", "time", "daily"]],
  ["for 5 minutes", ["sleep", "timer", "auto-off"]],
  ["after delay", ["sleep", "timer", "auto-off"]],
  ["wait then turn off", ["sleep", "timer", "auto-off"]],
  ["turn off after", ["sleep", "timer", "auto-off"]],
  ["stays for", ["remains", "duration"]],
  ["remains for", ["remains", "duration"]],
  ["location mode", ["location-mode", "mode"]],
  ["when i leave", ["presence", "departure", "lock"]],
  ["everyone leaves", ["presence", "departure"]],
  ["garage door", ["garage", "doorcontrol", "open"]],
  ["below threshold", ["comparison", "lessthan", "threshold"]],
  ["less than", ["comparison", "lessthan", "threshold"]],
  ["greater than", ["comparison", "lessthan", "threshold"]],
  ["at or below", ["comparison", "lessthan", "threshold"]],
  ["at or above", ["comparison", "lessthan", "threshold"]],
  ["drops below", ["changes", "lessthan", "threshold"]],
  ["falls below", ["changes", "lessthan", "threshold"]],
  ["becomes less than", ["changes", "lessthan", "threshold"]],
  ["only if", ["precondition", "trigger", "state-gate"]],
  ["only when", ["precondition", "trigger", "state-gate"]],
  ["while switch is on", ["precondition", "trigger", "switch", "on"]],
  ["선행조건", ["precondition", "trigger"]],
  ["조건부 트리거", ["precondition", "trigger"]],
  ["분 뒤", ["sleep", "timer", "auto-off"]],
  ["분 후", ["sleep", "timer", "auto-off"]],
  ["켰다가", ["sleep", "timer", "auto-off"]],
  ["기다렸다", ["sleep", "timer", "auto-off"]],
  ["동안 유지", ["remains", "duration"]],
  ["동안 없으면", ["remains", "duration"]],
  ["계속 없으면", ["remains", "duration"]],
  ["변할 때", ["changes", "변화할 때"]],
  ["바뀔 때", ["changes", "변화할 때"]],
  ["상태가 바뀌면", ["changes", "변화할 때"]],
  ["변경될 때", ["changes", "변화할 때"]],
  ["이하", ["comparison", "lessthan", "threshold"]],
  ["이상이면", ["comparison", "lessthan", "threshold"]],
  ["미만", ["comparison", "lessthan", "threshold"]],
  ["초과", ["comparison", "lessthan", "threshold"]],
  ["특정 시간", ["specific", "schedule", "time"]],
  ["정해진 시간", ["specific", "schedule", "time"]],
  ["매일 같은 시간", ["specific", "schedule", "time", "daily"]]
];

const QUERY_TERM_EXPANSIONS: Readonly<Record<string, readonly string[]>> = {
  active: ["motion"],
  away: ["presence", "departure", "location-mode"],
  below: ["lessthan", "threshold"],
  brightness: ["level", "switchlevel", "dimmer"],
  button: ["button", "trigger"],
  changes: ["change", "changed", "changing"],
  color: ["colorcontrol", "setcolor", "hue", "saturation"],
  colour: ["color", "colorcontrol"],
  contact: ["contactsensor", "door", "window"],
  daily: ["schedule", "time"],
  delay: ["sleep", "timer"],
  detected: ["active", "motion"],
  dimmer: ["level", "switchlevel"],
  door: ["contact", "contactsensor"],
  drops: ["changes", "lessthan", "threshold"],
  falls: ["changes", "lessthan", "threshold"],
  garage: ["doorcontrol", "open"],
  hue: ["color", "colorcontrol"],
  humidity: ["relativehumiditymeasurement", "threshold"],
  inactive: ["motion", "remains"],
  leave: ["presence", "departure"],
  leaves: ["presence", "departure"],
  level: ["switchlevel", "dimmer"],
  lights: ["light", "switch"],
  mode: ["location-mode"],
  motion: ["motionsensor"],
  occupancy: ["motion", "motionsensor"],
  precondition: ["trigger", "state-gate", "conditional-trigger"],
  red: ["color", "colorcontrol", "setcolor"],
  saturation: ["color", "colorcontrol"],
  schedule: ["time", "daily"],
  scheduled: ["schedule", "specific", "time"],
  specific: ["schedule", "time"],
  timer: ["sleep", "auto-off"],
  trigger: ["precondition"],
  under: ["lessthan", "threshold"],
  window: ["contact", "contactsensor"],
  감지: ["motion", "active"],
  감지하면: ["motion", "active"],
  꺼줘: ["off"],
  꺼짐: ["off", "auto-off"],
  기다렸다: ["sleep", "timer", "auto-off"],
  도어락: ["lock"],
  모션: ["motion"],
  동안: ["duration"],
  바뀌면: ["changes"],
  바뀔: ["changes", "변화할"],
  밝기: ["level", "switchlevel"],
  변할: ["changes", "변화할"],
  변화할: ["changes"],
  습도: ["humidity", "relativehumiditymeasurement", "threshold"],
  색: ["color"],
  색상: ["color"],
  선행조건: ["precondition", "trigger"],
  열리면: ["open", "contact"],
  외출: ["presence", "departure", "away"],
  움직임: ["motion"],
  유지되면: ["remains"],
  유지: ["remains"],
  지속되면: ["remains"],
  이하: ["comparison", "lessthan", "threshold"],
  이상: ["comparison", "lessthan", "threshold"],
  일몰: ["sunset"],
  자동: ["timer", "auto-off"],
  켰다가: ["sleep", "timer", "auto-off"],
  정시: ["specific", "schedule", "time"],
  정해진: ["specific", "schedule", "time"],
  조건부: ["precondition", "trigger"],
  초과: ["comparison", "lessthan", "threshold"],
  특정: ["specific", "schedule", "time"],
  특정시간: ["specific", "schedule", "time"],
  시간: ["specific", "schedule", "time"],
  시각: ["specific", "schedule", "time"],
  뒤: ["sleep", "timer", "auto-off"],
  후: ["sleep", "timer", "auto-off"],
  미만: ["comparison", "lessthan", "threshold"],
  켜기: ["on"],
  켜줘: ["on"],
  컬러: ["color"]
};

export const RULE_REFERENCE_CATALOG: readonly RuleReference[] = [
  {
    id: "contact-opens-switch-on",
    title: "Contact opens -> switch on",
    summary: "문/창 contactSensor가 open이면 switch 장치를 켜는 기본 if + equals + command 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / equals + Actions / command",
    patternKind: "derived",
    tags: ["contact", "door", "window", "light", "basic-trigger"],
    aliases: [
      "문 열림",
      "문이 열리면",
      "창문 열림",
      "도어 센서",
      "조명 켜기",
      "불 켜기",
      "door opens",
      "window opens",
      "contact opens",
      "when door opens turn on light",
      "turn on lights when a door opens"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["contactSensor"],
    actionCapabilities: ["switch"],
    conditions: ["equals"],
    operands: ["device", "string"],
    commands: ["on"],
    requiredContext: ["contactSensor deviceId", "switch deviceId"],
    mappingNotes: [
      "contactSensor 상태 비교는 device operand의 capability=contactSensor, attribute=contact를 사용한다.",
      "open 상태 비교는 right.string=\"open\" 형태를 사용한다.",
      "별도 trigger 필드를 지정하지 않는 기본 equals 예시다.",
      "다른 상태를 gate로만 검사해야 하면 precondition 예시의 trigger Always/Never 패턴을 함께 검토한다.",
      "switch command는 component=main, capability=switch, command=on 형태를 사용한다."
    ],
    example: {
      name: "Open entry sensor turns on hallway lamp",
      actions: [
        {
          if: {
            equals: {
              left: {
                device: {
                  devices: ["<contactSensorDeviceId>"],
                  component: "main",
                  capability: "contactSensor",
                  attribute: "contact"
                }
              },
              right: { string: "open" }
            },
            then: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "on",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "motion-active-switch-on",
    title: "Motion active -> switch on",
    summary: "motionSensor가 active이면 switch 장치를 켜는 motion 기반 if + equals + command 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / equals + Actions / command",
    patternKind: "derived",
    tags: ["motion", "light", "occupancy", "basic-trigger"],
    aliases: [
      "모션 감지",
      "움직임 감지",
      "동작 감지",
      "사람이 지나가면",
      "조명 켜기",
      "불 켜기",
      "motion detected",
      "motion becomes active",
      "when motion is detected",
      "turn on lights when motion is active",
      "occupancy detected"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["motionSensor"],
    actionCapabilities: ["switch"],
    conditions: ["equals"],
    operands: ["device", "string"],
    commands: ["on"],
    requiredContext: ["motionSensor deviceId", "switch deviceId"],
    mappingNotes: [
      "motionSensor 상태 비교는 capability=motionSensor, attribute=motion를 사용한다.",
      "active 상태 비교는 right.string=\"active\" 형태를 사용한다.",
      "motion active가 Rule을 시작하는 단일 조건일 때 쓰는 예시다.",
      "motion이 다른 이벤트의 gate라면 precondition 예시를 검토하거나 실행 시작 이벤트를 사용자에게 확인한다."
    ],
    example: {
      name: "Workspace motion turns on task lamp",
      actions: [
        {
          if: {
            equals: {
              left: {
                device: {
                  devices: ["<motionSensorDeviceId>"],
                  component: "main",
                  capability: "motionSensor",
                  attribute: "motion"
                }
              },
              right: { string: "active" }
            },
            then: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "on",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "motion-inactive-remains-switch-off",
    title: "Motion inactive remains -> switch off",
    summary: "motionSensor가 inactive 상태로 일정 시간 유지되면 switch를 끄는 remains 조건 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / remains + equals",
    patternKind: "derived",
    tags: ["motion", "no-motion", "timeout", "light"],
    aliases: [
      "움직임 없음",
      "모션 없음",
      "일정 시간 동안",
      "5분 동안 움직임 없으면",
      "움직임이 계속 없으면",
      "모션이 일정 시간 없으면",
      "유지되면",
      "꺼줘",
      "불 끄기",
      "자동 꺼짐",
      "no motion",
      "motion inactive",
      "motion remains inactive",
      "after no motion",
      "after no motion for 5 minutes",
      "turn off after no motion",
      "turn off lights after motion stops",
      "motion stays inactive for minutes"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["motionSensor"],
    actionCapabilities: ["switch"],
    conditions: ["remains", "equals"],
    operands: ["device", "string", "integer"],
    commands: ["off"],
    requiredContext: ["motionSensor deviceId", "switch deviceId", "duration minutes"],
    mappingNotes: [
      "remains는 일정 시간 조건이 유지될 때 true가 되는 조건으로 사용한다.",
      "motion inactive 상태가 N분 유지될 때 쓰며, inactive로 바뀌는 순간은 changes 계열 예시를 검토한다.",
      "명령 후 N분 기다렸다 다음 명령을 실행하는 흐름은 sleep action 예시를 사용한다.",
      "duration은 value + unit 구조를 사용하며 unit은 Minute, Second 등으로 표현한다.",
      "꺼짐 동작은 switch capability의 off command를 사용한다."
    ],
    example: {
      name: "Quiet hallway turns off its lamp after seven minutes",
      actions: [
        {
          if: {
            remains: {
              id: "quiet-hallway-window",
              equals: {
                left: {
                  device: {
                    devices: ["<motionSensorDeviceId>"],
                    component: "main",
                    capability: "motionSensor",
                    attribute: "motion"
                  }
                },
                right: { string: "inactive" }
              },
              duration: {
                value: { integer: 7 },
                unit: "Minute"
              }
            },
            then: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "off",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "schedule-switch-off",
    title: "Scheduled time -> switch off",
    summary: "정해진 시간마다 switch를 끄는 every + datetime/specific + command 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Actions / every + datetime specific",
    patternKind: "derived",
    tags: ["schedule", "time", "daily", "light", "specific"],
    aliases: [
      "예약",
      "정해진 시간",
      "매일",
      "스케줄",
      "오전",
      "오후",
      "불 끄기",
      "조명 끄기",
      "schedule",
      "scheduled time",
      "daily schedule",
      "every day at a time",
      "turn off lights at 11",
      "turn off switch at a scheduled time"
    ],
    constructs: ["every", "command"],
    triggerCapabilities: [],
    actionCapabilities: ["switch"],
    conditions: [],
    operands: ["datetime", "specific", "time", "integer"],
    commands: ["off"],
    requiredContext: ["switch deviceId", "timeZoneId", "time value"],
    mappingNotes: [
      "정시 실행은 every action의 specific datetime operand로 표현한다.",
      "사용자 위치의 timeZoneId를 명시하면 시간 해석이 안정적이다.",
      "반복 요일이 필요하면 datetime.daysOfWeek를 추가한다."
    ],
    example: {
      name: "Turn off porch switch at 12:15 PM",
      actions: [
        {
          every: {
            specific: {
              reference: "Noon",
              offset: {
                value: { integer: 15 },
                unit: "Minute"
              }
            },
            actions: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "off",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "sunset-switch-on",
    title: "Sunset -> switch on",
    summary: "일몰 기준 시각에 switch를 켜는 every + datetime reference=Sunset 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Actions / every + Sunset reference",
    patternKind: "derived",
    tags: ["sunset", "sunrise", "time", "light", "specific"],
    aliases: [
      "해질 때",
      "일몰",
      "석양",
      "저녁",
      "노을",
      "불 켜기",
      "조명 켜기",
      "sunset",
      "sunrise",
      "when the sun sets",
      "at sunset",
      "turn on lights at sunset",
      "evening lights"
    ],
    constructs: ["every", "command"],
    triggerCapabilities: [],
    actionCapabilities: ["switch"],
    conditions: [],
    operands: ["datetime", "specific", "time"],
    commands: ["on"],
    requiredContext: ["switch deviceId", "locationId", "timeZoneId"],
    mappingNotes: [
      "Sunset/Sunrise 기준 실행은 datetime.reference에 Sunset 또는 Sunrise를 둔다.",
      "offset을 추가하면 일몰 전후 n분 실행 패턴으로 확장할 수 있다.",
      "이 템플릿은 Sunset reference와 offset 문법만 보여준다. 생성 단계에서 필요하면 사용자 위치 정보를 보강한다."
    ],
    example: {
      name: "Turn on porch light twenty minutes before sunset",
      actions: [
        {
          every: {
            specific: {
              reference: "Sunset",
              offset: {
                value: { integer: -20 },
                unit: "Minute"
              }
            },
            actions: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "on",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "switch-on-sleep-switch-off",
    title: "Switch on -> sleep -> switch off",
    summary: "switch를 켠 뒤 일정 시간 sleep 후 다시 끄는 command + sleep + command 순차 실행 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Actions / command + sleep",
    patternKind: "derived",
    tags: ["sleep", "timer", "auto-off", "light"],
    aliases: [
      "5분 뒤",
      "5분 후",
      "잠시 켰다가",
      "켜고 5분 뒤 꺼줘",
      "켜고 5분 후 꺼줘",
      "켜고 기다렸다 꺼줘",
      "자동으로 꺼줘",
      "타이머",
      "지연",
      "대기",
      "sleep",
      "timer",
      "auto off",
      "turn on for 5 minutes",
      "turn it on for 5 minutes",
      "turn on then wait and turn off",
      "turn off after delay",
      "wait then turn off",
      "sleep then switch off"
    ],
    constructs: ["command", "sleep"],
    triggerCapabilities: [],
    actionCapabilities: ["switch"],
    conditions: [],
    operands: ["integer"],
    commands: ["on", "off"],
    requiredContext: ["switch deviceId", "duration"],
    mappingNotes: [
      "sleep action은 조건이 아니라 이미 실행 중인 action sequence의 대기 단계다.",
      "sleep action은 duration.value와 duration.unit으로 대기 시간을 표현한다.",
      "actions 배열 순서가 순차 실행 의도를 나타낸다.",
      "상태가 N분 유지되면 실행하는 의미는 sleep이 아니라 remains 조건 예시를 사용한다.",
      "자동 꺼짐 Rule을 만들 때 command on 다음 sleep, command off 순서로 참조한다."
    ],
    example: {
      name: "Run indicator switch for three minutes",
      actions: [
        {
          command: {
            devices: ["<switchDeviceId>"],
            commands: [
              {
                component: "main",
                capability: "switch",
                command: "on",
                arguments: []
              }
            ]
          }
        },
        {
          sleep: {
            duration: {
              value: { integer: 3 },
              unit: "Minute"
            }
          }
        },
        {
          command: {
            devices: ["<switchDeviceId>"],
            commands: [
              {
                component: "main",
                capability: "switch",
                command: "off",
                arguments: []
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "location-mode-switch-command",
    title: "Location mode equals -> switch command",
    summary: "location Mode가 특정 값이면 switch command를 실행하는 location operand 패턴.",
    sourceName: "SmartThings Rules guide",
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / and + or",
    patternKind: "derived",
    tags: ["location-mode", "mode", "presence", "home-away"],
    aliases: [
      "모드",
      "외출 모드",
      "귀가 모드",
      "집 모드",
      "위치 모드",
      "장소 모드",
      "location mode",
      "home mode",
      "away mode",
      "night mode",
      "when mode is away",
      "if location mode is home"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: [],
    actionCapabilities: ["switch"],
    conditions: ["equals"],
    operands: ["location", "string"],
    commands: ["on", "off"],
    requiredContext: ["locationId", "modeId", "switch deviceId"],
    mappingNotes: [
      "location mode 비교는 left.location.attribute=Mode와 right.string=<modeId> 구조를 사용한다.",
      "이 예시는 location mode 자체를 비교하는 상태 조건이다.",
      "다른 device 이벤트가 Rule을 시작하고 location mode는 gate로만 쓰여야 하면 precondition/trigger 패턴을 검토하거나 사용자에게 확인한다.",
      "modeId는 location modes 조회 결과가 필요하므로 생성 단계에서 별도 조회/입력이 필요하다.",
      "then/else에 서로 다른 switch command를 넣는 패턴으로 확장할 수 있다."
    ],
    example: {
      name: "Control switch when location mode matches",
      actions: [
        {
          if: {
            equals: {
              left: {
                location: {
                  locationId: "<locationId>",
                  attribute: "Mode"
                }
              },
              right: { string: "<modeId>" }
            },
            then: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "off",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "humidity-less-than-with-switch-precondition",
    title: "Humidity below threshold with switch off precondition",
    summary:
      "습도가 기준보다 낮고 가습기가 꺼져 있을 때만 switch on command를 실행하는 plain comparison + trigger precondition 패턴.",
    sourceName: "SmartThings Rules guide",
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / comparison with trigger precondition",
    patternKind: "derived",
    tags: [
      "humidity",
      "relativeHumidityMeasurement",
      "threshold",
      "comparison",
      "humidifier",
      "precondition",
      "state-gate"
    ],
    aliases: [
      "습도",
      "가습기",
      "습도가 낮으면",
      "습도가 35 이하면",
      "습도가 35 미만이면",
      "습도가 기준 이하면",
      "습도가 기준 미만이면",
      "습도가 기준 이상이면",
      "습도가 기준 초과면",
      "이하면 항상",
      "미만이면 항상",
      "이상이면 항상",
      "초과면 항상",
      "humidity below threshold",
      "humidity less than threshold",
      "humidity at or below threshold",
      "humidity greater than threshold",
      "humidity at or above threshold",
      "turn on humidifier when humidity is low",
      "only if humidifier is off"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["relativeHumidityMeasurement"],
    actionCapabilities: ["switch"],
    conditions: ["and", "lessThan", "equals"],
    operands: ["device", "integer", "string", "trigger"],
    commands: ["on"],
    requiredContext: [
      "humidity sensor deviceId",
      "humidity threshold",
      "humidifier switch deviceId"
    ],
    mappingNotes: [
      "lessThan은 현재 측정값이 threshold보다 낮은지 평가하는 plain comparison 대표 예시다.",
      "루틴의 이하/이상/미만/초과 표현도 같은 comparison shape를 쓰며, 실제 의도에 맞게 lessThan 계열 operator만 바꿔 작성한다.",
      "humidity 조건은 Rule을 시작해야 하므로 trigger=\"Always\"로 둔다.",
      "humidifier switch off 조건은 중복 on command를 줄이는 gate이므로 trigger=\"Never\"로 둔다.",
      "기준 아래로 진입하는 순간만 필요하면 changes 예시를, 진입 순간과 gate 조건을 함께 쓰려면 changes-with-precondition 예시를 검토한다.",
      "기준 미만 상태가 일정 시간 유지되어야 하면 remains + comparison 예시를 검토한다."
    ],
    example: {
      name: "Turn on humidifier when humidity is below threshold",
      actions: [
        {
          if: {
            and: [
              {
                lessThan: {
                  left: {
                    device: {
                      devices: ["<humiditySensorDeviceId>"],
                      component: "main",
                      capability: "relativeHumidityMeasurement",
                      attribute: "humidity",
                      trigger: "Always"
                    }
                  },
                  right: { integer: 35 }
                }
              },
              {
                equals: {
                  left: {
                    device: {
                      devices: ["<humidifierDeviceId>"],
                      component: "main",
                      capability: "switch",
                      attribute: "switch",
                      trigger: "Never"
                    }
                  },
                  right: { string: "off" }
                }
              }
            ],
            then: [
              {
                command: {
                  devices: ["<humidifierDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "on",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "switch-level-remains-less-than",
    title: "Switch level remains below threshold",
    summary: "switchLevel 값이 기준보다 낮은 상태로 유지되면 command를 실행하는 lessThan + remains 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / remains + lessThan",
    patternKind: "derived",
    tags: ["switchLevel", "level", "dimmer", "threshold"],
    aliases: [
      "밝기",
      "레벨",
      "디머",
      "기준보다 낮으면",
      "기준 이하로 유지되면",
      "기준 이상으로 유지되면",
      "기준 미만으로 유지되면",
      "기준 초과로 유지되면",
      "임계값",
      "유지되면",
      "brightness",
      "dimmer level",
      "level stays below",
      "brightness remains low",
      "level remains at or below threshold",
      "level remains at or above threshold",
      "dimmer below threshold for seconds",
      "level remains less than threshold"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["switchLevel"],
    actionCapabilities: ["switch"],
    conditions: ["remains", "lessThan"],
    operands: ["device", "integer"],
    commands: ["off"],
    requiredContext: ["switchLevel deviceId", "threshold", "duration", "switch deviceId"],
    mappingNotes: [
      "switchLevel 값 비교는 capability=switchLevel, attribute=level을 사용한다.",
      "숫자 기준값은 right.integer 또는 right.decimal 형태로 표현한다.",
      "remains와 비교 조건을 결합해 기준 미만 상태가 일정 시간 유지되는 조건을 표현한다.",
      "현재 값이 기준을 만족하면 항상 실행하는 의미는 humidity-less-than-with-switch-precondition 같은 plain comparison 예시를 검토한다.",
      "기준 아래로 진입하는 순간만 필요하면 switch-level-changes-less-than 예시를 검토한다."
    ],
    example: {
      name: "Dimmer below 30 percent for 45 seconds turns off target switch",
      actions: [
        {
          if: {
            remains: {
              lessThan: {
                left: {
                  device: {
                    devices: ["<switchLevelDeviceId>"],
                    component: "main",
                    capability: "switchLevel",
                    attribute: "level"
                  }
                },
                right: { integer: 30 }
              },
              duration: {
                value: { integer: 45 },
                unit: "Second"
              }
            },
            then: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "off",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "switch-level-changes-less-than",
    title: "Switch level changes below threshold",
    summary:
      "switchLevel 값이 기준 아래로 진입할 때만 command를 실행하는 changes + lessThan 패턴.",
    sourceName: "SmartThings Rules guide",
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / changes with lessThan",
    patternKind: "derived",
    tags: ["changes", "threshold", "level", "dimmer", "one-shot", "edge-trigger"],
    aliases: [
      "기준 아래로 바뀌면",
      "기준 이하로 바뀌면",
      "기준 이상으로 바뀌면",
      "기준 미만으로 바뀌면",
      "기준 초과로 바뀌면",
      "값이 내려가면",
      "한 번만 실행",
      "진입할 때",
      "변화할 때",
      "변할 때",
      "바뀔 때",
      "상태가 바뀌면",
      "변경될 때",
      "changes",
      "when value changes",
      "when level changes",
      "when level drops below",
      "when brightness changes below",
      "when level becomes less than",
      "when level becomes at or below threshold",
      "when level becomes at or above threshold",
      "falls below threshold"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["switchLevel"],
    actionCapabilities: ["switch"],
    conditions: ["changes", "lessThan"],
    operands: ["device", "integer"],
    commands: ["off"],
    requiredContext: ["switchLevel deviceId", "threshold", "switch deviceId"],
    mappingNotes: [
      "changes는 내부 조건이 false에서 true로 바뀌는 순간에만 true가 되는 조건이다.",
      "switchLevel 값이 threshold 미만 상태로 계속 머무는 동안 반복 실행되지 않게 할 때 사용한다.",
      "이미 기준 아래인 현재 상태를 검사하려면 humidity-less-than-with-switch-precondition 같은 plain comparison을, 기준 미만 상태가 일정 시간 유지되어야 하면 remains 예시를 검토한다.",
      "changes 되는 순간에 다른 상태 gate도 필요하면 switch-level-changes-less-than-with-switch-precondition 예시를 검토한다.",
      "공식 문서는 changes로 lessThan 조건을 감싸는 형태를 제시한다."
    ],
    example: {
      name: "When switch level changes below threshold, turn off switch",
      actions: [
        {
          if: {
            changes: {
              lessThan: {
                left: {
                  device: {
                    devices: ["<switchLevelDeviceId>"],
                    component: "main",
                    capability: "switchLevel",
                    attribute: "level"
                  }
                },
                right: { integer: 50 }
              }
            },
            then: [
              {
                command: {
                  devices: ["<switchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "off",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "switch-level-changes-less-than-with-switch-precondition",
    title: "Switch level changes below threshold with switch precondition",
    summary:
      "switchLevel 값이 기준 아래로 진입하는 순간에 다른 switch 상태를 gate로 검사하는 changes + trigger precondition 패턴.",
    sourceName: "SmartThings Rules guide",
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / changes + Operands / trigger",
    patternKind: "derived",
    tags: [
      "changes",
      "threshold",
      "level",
      "dimmer",
      "one-shot",
      "edge-trigger",
      "precondition",
      "state-gate"
    ],
    aliases: [
      "기준 아래로 바뀔 때 스위치가 켜져 있으면",
      "기준 아래로 진입할 때 스위치가 켜져 있으면",
      "바뀌는 순간 스위치가 켜져 있으면",
      "변하는 순간 다른 조건이 맞으면",
      "changes with state gate",
      "level change with state gate",
      "edge trigger with gate"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["switchLevel"],
    actionCapabilities: ["switch"],
    conditions: ["and", "changes", "lessThan", "equals"],
    operands: ["device", "integer", "string", "trigger"],
    commands: ["off"],
    requiredContext: [
      "switchLevel deviceId",
      "threshold",
      "gate switch deviceId",
      "target switch deviceId"
    ],
    mappingNotes: [
      "changes 조건은 상태 전이를 잡는 실행 시작 조건이다.",
      "changes 안의 device operand에는 trigger=\"Never\"를 붙이지 않는다.",
      "gate 역할의 상태 조건에만 trigger=\"Never\"를 둔다."
    ],
    example: {
      name: "When level changes with a switch gate, turn off target switch",
      actions: [
        {
          if: {
            and: [
              {
                changes: {
                  lessThan: {
                    left: {
                      device: {
                        devices: ["<switchLevelDeviceId>"],
                        component: "main",
                        capability: "switchLevel",
                        attribute: "level"
                      }
                    },
                    right: { integer: 50 }
                  }
                }
              },
              {
                equals: {
                  left: {
                    device: {
                      devices: ["<gateSwitchDeviceId>"],
                      component: "main",
                      capability: "switch",
                      attribute: "switch",
                      trigger: "Never"
                    }
                  },
                  right: { string: "on" }
                }
              }
            ],
            then: [
              {
                command: {
                  devices: ["<targetSwitchDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "switch",
                      command: "off",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "presence-departure-lock",
    title: "Presence departure -> lock command",
    summary: "presenceSensor 상태가 not present이면 lock command를 실행하는 presence + lock 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / equals + lock command",
    patternKind: "derived",
    tags: ["presence", "departure", "lock", "door-lock"],
    aliases: [
      "외출",
      "떠나면",
      "나가면",
      "부재",
      "문 잠금",
      "잠가줘",
      "도어락",
      "when I leave",
      "when everyone leaves",
      "presence not present",
      "departure",
      "lock when away",
      "lock door when I leave"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["presenceSensor"],
    actionCapabilities: ["lock"],
    conditions: ["equals"],
    operands: ["device", "string"],
    commands: ["lock"],
    requiredContext: ["presenceSensor deviceId", "lock deviceId"],
    mappingNotes: [
      "presenceSensor는 attribute=presence 값을 present/not present와 비교하는 상태 조건으로 쓴다.",
      "이 예시는 presence == not present 기반의 departure 패턴이다.",
      "presence를 다른 이벤트의 gate로만 써야 하면 precondition 예시를 검토한다.",
      "lock action은 capability=lock, command=lock 구조를 참조한다.",
    ],
    example: {
      name: "Lock entry when household presence is away",
      actions: [
        {
          if: {
            equals: {
              left: {
                device: {
                  devices: ["<presenceSensorDeviceId>"],
                  component: "main",
                  capability: "presenceSensor",
                  attribute: "presence"
                }
              },
              right: { string: "not present" }
            },
            then: [
              {
                command: {
                  devices: ["<lockDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "lock",
                      command: "lock",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "button-press-with-switch-precondition",
    title: "Button pressed with switch precondition",
    summary:
      "button 이벤트만 Rule을 트리거하고 switch 상태는 선행조건으로만 검사하는 trigger Always/Never 패턴.",
    sourceName: "SmartThings Rules guide",
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Operands / trigger",
    patternKind: "derived",
    tags: [
      "precondition",
      "trigger",
      "button",
      "switch",
      "state-gate",
      "conditional-trigger"
    ],
    aliases: [
      "선행조건",
      "조건부 트리거",
      "버튼이 눌릴 때만",
      "스위치가 켜져 있을 때",
      "상태를 조건으로",
      "precondition",
      "button pressed while switch is on",
      "button pressed only if switch is on",
      "when button is pushed and switch is on",
      "only when switch is on",
      "while switch is on",
      "state gate",
      "condition gate"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["button"],
    actionCapabilities: ["switch"],
    conditions: ["equals"],
    operands: ["device", "string", "trigger"],
    commands: ["on", "off"],
    requiredContext: [
      "button deviceId",
      "precondition switch deviceId",
      "target switch deviceId"
    ],
    mappingNotes: [
      "A 상태일 때 B 이벤트가 발생하면 쓰는 precondition 패턴이다.",
      "trigger=\"Always\"인 button 조건만 Rule 실행을 시작하도록 지정한다.",
      "trigger=\"Never\"인 switch 조건은 Rule을 시작하지 않고 선행조건 검사로만 사용한다.",
      "\"A와 B가 모두 참이면\"처럼 실행 시작 이벤트가 명확하지 않으면 바로 이 예시를 쓰지 말고 사용자에게 어떤 이벤트가 Rule을 시작해야 하는지 확인한다.",
      "SmartThings 앱의 선행조건은 공식 Rules 문서의 trigger/precondition operand 설명에 대응한다."
    ],
    example: {
      name: "When button is pushed and switch is on, control target switch",
      actions: [
        {
          if: {
            equals: {
              left: { string: "pushed" },
              right: {
                device: {
                  devices: ["<buttonDeviceId>"],
                  component: "main",
                  capability: "button",
                  attribute: "button",
                  trigger: "Always"
                }
              }
            },
            then: [
              {
                if: {
                  equals: {
                    left: {
                      device: {
                        devices: ["<preconditionSwitchDeviceId>"],
                        component: "main",
                        capability: "switch",
                        attribute: "switch",
                        trigger: "Never"
                      }
                    },
                    right: { string: "on" }
                  },
                  then: [
                    {
                      command: {
                        devices: ["<targetSwitchDeviceId>"],
                        commands: [
                          {
                            component: "main",
                            capability: "switch",
                            command: "on",
                            arguments: []
                          }
                        ]
                      }
                    }
                  ],
                  else: [
                    {
                      command: {
                        devices: ["<targetSwitchDeviceId>"],
                        commands: [
                          {
                            component: "main",
                            capability: "switch",
                            command: "off",
                            arguments: []
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "switch-opens-garage",
    title: "Switch command -> garage door command",
    summary: "switch 상태 변화에 따라 doorControl command를 실행하는 command 참조 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Conditions / equals + doorControl command",
    patternKind: "derived",
    tags: ["garage", "switch", "door", "command"],
    aliases: [
      "차고",
      "차고문",
      "garage",
      "스위치를 켜면",
      "문 열기",
      "열어줘",
      "garage door",
      "open garage",
      "open garage when switch turns on",
      "switch controls garage door",
      "garage door opens"
    ],
    constructs: ["if", "command"],
    triggerCapabilities: ["switch"],
    actionCapabilities: ["doorControl"],
    conditions: ["equals"],
    operands: ["device", "string"],
    commands: ["open", "close"],
    requiredContext: ["switch deviceId", "doorControl deviceId"],
    mappingNotes: [
      "switch 상태 비교는 capability=switch, attribute=switch 값을 on/off와 비교한다.",
      "별도 trigger 필드를 지정하지 않는 기본 equals 예시다.",
      "switch 상태를 다른 이벤트의 gate로만 써야 하면 precondition 예시를 검토한다.",
      "이 프로젝트 템플릿은 Door Control capability 기준으로 doorControl command를 사용한다."
    ],
    example: {
      name: "Wall switch opens garage door",
      actions: [
        {
          if: {
            equals: {
              left: {
                device: {
                  devices: ["<switchDeviceId>"],
                  component: "main",
                  capability: "switch",
                  attribute: "switch"
                }
              },
              right: { string: "on" }
            },
            then: [
              {
                command: {
                  devices: ["<garageDoorDeviceId>"],
                  commands: [
                    {
                      component: "main",
                      capability: "doorControl",
                      command: "open",
                      arguments: []
                    }
                  ]
                }
              }
            ]
          }
        }
      ]
    }
  },
  {
    id: "color-control-set-color",
    title: "Set color command",
    summary: "colorControl capability의 setColor command와 argument 구조를 참조하는 색상 제어 패턴.",
    sourceName: PROJECT_TEMPLATE_SOURCE,
    sourceUrl: SMARTTHINGS_RULES_GUIDE,
    sourceExamplePath: "Rules guide / Actions / command arguments",
    patternKind: "derived",
    tags: ["color", "colorControl", "light", "arguments"],
    aliases: [
      "색상",
      "컬러",
      "색 바꾸기",
      "전구 색",
      "조명 색",
      "hue",
      "saturation",
      "set light color",
      "change bulb color",
      "make the light red",
      "turn the light red",
      "set hue and saturation",
      "color command arguments"
    ],
    constructs: ["command"],
    triggerCapabilities: [],
    actionCapabilities: ["colorControl", "switch"],
    conditions: [],
    operands: ["map", "integer", "string"],
    commands: ["setColor"],
    requiredContext: ["colorControl deviceId", "color argument"],
    mappingNotes: [
      "setColor command는 capability=colorControl, command=setColor를 사용한다.",
      "색상 argument는 capability 정의에 맞는 map operand로 구성한다.",
      "색상 명령 전후에 switch on command를 함께 둘 수 있다."
    ],
    example: {
      name: "Set reading lamp to a cool accent color",
      actions: [
        {
          command: {
            devices: ["<colorLightDeviceId>"],
            commands: [
              {
                component: "main",
                capability: "colorControl",
                command: "setColor",
                arguments: [
                  {
                    map: {
                      hue: { integer: 65 },
                      saturation: { integer: 80 }
                    }
                  }
                ]
              }
            ]
          }
        }
      ]
    }
  }
];

export function searchRuleReferences(
  filters: RuleReferenceSearchFilters = {}
): RuleReferenceSearchResult[] {
  const normalized = normalizeFilters(filters);
  const hasFilters = hasActiveFilters(normalized);

  return RULE_REFERENCE_CATALOG.map((reference, index) => ({
    reference,
    index,
    score: scoreReference(reference, normalized)
  }))
    .filter(({ score }) => !hasFilters || score.value > 0)
    .sort((left, right) => {
      if (right.score.value !== left.score.value) {
        return right.score.value - left.score.value;
      }
      return left.index - right.index;
    })
    .slice(0, normalized.limit)
    .map(({ reference, score }) => toSearchResult(reference, score, hasFilters));
}

export function getRuleReference(referenceId: string): RuleReference | undefined {
  const normalizedId = normalize(referenceId);
  return RULE_REFERENCE_CATALOG.find((reference) => normalize(reference.id) === normalizedId);
}

export function referenceFiltersFromUrl(url: string): RuleReferenceSearchFilters {
  const params = new URL(url).searchParams;
  return {
    query: textParam(params, "query") ?? textParam(params, "q"),
    constructs: listParam(params, "constructs"),
    triggerCapabilities: listParam(params, "triggerCapabilities"),
    actionCapabilities: listParam(params, "actionCapabilities"),
    conditions: listParam(params, "conditions"),
    operands: listParam(params, "operands"),
    commands: listParam(params, "commands"),
    tags: listParam(params, "tags"),
    limit: numberParam(params, "limit")
  };
}

interface NormalizedFilters {
  query: string;
  queryTerms: string[];
  constructs: Set<string>;
  triggerCapabilities: Set<string>;
  actionCapabilities: Set<string>;
  conditions: Set<string>;
  operands: Set<string>;
  commands: Set<string>;
  tags: Set<string>;
  limit: number;
}

interface Score {
  value: number;
  matchedFields: string[];
}

function normalizeFilters(filters: RuleReferenceSearchFilters): NormalizedFilters {
  const query = normalize(filters.query ?? "");
  return {
    query,
    queryTerms: queryTermsFor(query),
    constructs: normalizeSet(filters.constructs),
    triggerCapabilities: normalizeSet(filters.triggerCapabilities),
    actionCapabilities: normalizeSet(filters.actionCapabilities),
    conditions: normalizeSet(filters.conditions),
    operands: normalizeSet(filters.operands),
    commands: normalizeSet(filters.commands),
    tags: normalizeSet(filters.tags),
    limit: normalizeLimit(filters.limit)
  };
}

function hasActiveFilters(filters: NormalizedFilters): boolean {
  return (
    Boolean(filters.query) ||
    filters.constructs.size > 0 ||
    filters.triggerCapabilities.size > 0 ||
    filters.actionCapabilities.size > 0 ||
    filters.conditions.size > 0 ||
    filters.operands.size > 0 ||
    filters.commands.size > 0 ||
    filters.tags.size > 0
  );
}

function scoreReference(reference: RuleReference, filters: NormalizedFilters): Score {
  const matchedFields: string[] = [];
  let value = 0;

  value += scoreList(reference.triggerCapabilities, filters.triggerCapabilities, 12, "triggerCapabilities", matchedFields);
  value += scoreList(reference.actionCapabilities, filters.actionCapabilities, 12, "actionCapabilities", matchedFields);
  value += scoreList(reference.commands, filters.commands, 10, "commands", matchedFields);
  value += scoreList(reference.constructs, filters.constructs, 8, "constructs", matchedFields);
  value += scoreList(reference.conditions, filters.conditions, 7, "conditions", matchedFields);
  value += scoreList(reference.operands, filters.operands, 6, "operands", matchedFields);
  value += scoreList(reference.tags, filters.tags, 5, "tags", matchedFields);

  if (filters.query) {
    const exampleName =
      typeof reference.example.name === "string" ? reference.example.name : "";
    const searchable = [
      reference.id,
      reference.title,
      reference.summary,
      reference.sourceExamplePath,
      exampleName,
      ...reference.tags,
      ...reference.aliases,
      ...reference.constructs,
      ...reference.triggerCapabilities,
      ...reference.actionCapabilities,
      ...reference.conditions,
      ...reference.operands,
      ...reference.commands,
      ...reference.requiredContext,
      ...reference.mappingNotes
    ]
      .map(normalize)
      .join(" ");

    if (searchable.includes(filters.query)) {
      value += 10;
      matchedFields.push(`query:${filters.query}`);
    }

    for (const term of filters.queryTerms) {
      if (searchable.includes(term)) {
        value += 3;
        matchedFields.push(`query:${term}`);
      }
    }
  }

  return {
    value,
    matchedFields: [...new Set(matchedFields)]
  };
}

function queryTermsFor(query: string): string[] {
  if (!query) {
    return [];
  }

  const terms = new Set<string>();
  const baseTerms = splitQueryTerms(query);
  for (const term of baseTerms) {
    addQueryTerms(terms, [term]);
    addQueryTerms(terms, singularEnglishTerm(term));
    addQueryTerms(terms, QUERY_TERM_EXPANSIONS[term] ?? []);
  }

  for (const [phrase, expansions] of QUERY_PHRASE_EXPANSIONS) {
    if (query.includes(normalize(phrase))) {
      addQueryTerms(terms, expansions);
    }
  }

  if (looksLikeSpecificTimeQuery(query)) {
    addQueryTerms(terms, ["specific", "schedule", "time"]);
  }

  return [...terms].filter(
    (term) => term.length > 1 && !QUERY_STOP_WORDS.has(term)
  );
}

function looksLikeSpecificTimeQuery(query: string): boolean {
  return (
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/u.test(query) ||
    /\b(?:at|by)\s+\d{1,2}(?::\d{2})?\b/u.test(query) ||
    /(?:오전|오후)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?(?:에|마다)?/u.test(query)
  );
}

function splitQueryTerms(value: string): string[] {
  return normalize(value)
    .split(/[\s,./:_-]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !QUERY_STOP_WORDS.has(term));
}

function addQueryTerms(target: Set<string>, values: readonly string[] | string): void {
  const list = Array.isArray(values) ? values : [values];
  for (const value of list) {
    for (const term of splitQueryTerms(value)) {
      target.add(term);
    }
  }
}

function singularEnglishTerm(term: string): string[] {
  if (/^[a-z]+s$/u.test(term) && term.length > 3) {
    return [term.slice(0, -1)];
  }
  return [];
}

function scoreList(
  values: string[],
  filters: Set<string>,
  weight: number,
  fieldName: string,
  matchedFields: string[]
): number {
  if (filters.size === 0) {
    return 0;
  }

  const normalizedValues = new Set(values.map(normalize));
  let score = 0;
  for (const filter of filters) {
    if (normalizedValues.has(filter)) {
      score += weight;
      matchedFields.push(`${fieldName}:${filter}`);
    }
  }
  return score;
}

function toSearchResult(
  reference: RuleReference,
  score: Score,
  hasFilters: boolean
): RuleReferenceSearchResult {
  const { example: _example, mappingNotes: _mappingNotes, ...summary } = reference;
  return {
    ...summary,
    score: score.value,
    matchedFields: score.matchedFields,
    matchReason:
      score.matchedFields.length > 0
        ? `Matched ${score.matchedFields.join(", ")}`
        : hasFilters
          ? "No explicit field match"
          : "Default reference candidate"
  };
}

function normalizeSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .flatMap((value) => value.split(","))
      .map(normalize)
      .filter(Boolean)
  );
}

function listParam(params: URLSearchParams, name: string): string[] | undefined {
  const values = params.getAll(name).flatMap((value) => value.split(","));
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  return trimmed.length > 0 ? trimmed : undefined;
}

function textParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value || undefined;
}

function numberParam(params: URLSearchParams, name: string): number | undefined {
  const value = params.get(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit as number)));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
