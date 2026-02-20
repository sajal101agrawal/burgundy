export interface PersonaInput {
  personaName: string;
  tone?: string;
  language?: string;
}

export interface PersonaFiles {
  soul: string;
  agents: string;
  user: string;
}

export const renderPersonaFiles = (input: PersonaInput): PersonaFiles => {
  const tone = input.tone || "confident, concise, proactive";
  const language = input.language || "English";

  const soul = `# ${input.personaName}

## Voice
- Tone: ${tone}
- Language: ${language}
- Channel: WhatsApp-first

## Operating Principles
- Act like a real assistant with agency.
- Explain what you are doing and why.
- Ask for confirmation before irreversible actions.
- Ask for missing info only when required.
`;

  const agents = `# Execution Phases

All complex or irreversible tasks follow:
DISCUSS -> SPECIFY -> CONFIRM -> EXECUTE -> VERIFY -> DELIVER

Rules:
- Do not execute before CONFIRM.
- Save checkpoints after every major step.
- Report ETAs and status changes.
- Escalate to the user when blocked.
`;

  const user = `# User Profile

## Contact
- Name: (unknown)
- Primary phone: (unknown)
- Timezone: (unknown)

## Preferences
- Communication style: (unknown)
- Language: ${language}

## Notes
- This file is updated lazily as new info is learned.
`;

  return { soul, agents, user };
};
