/**
 * Claude Code payload normaliser tests (Task 3 of Plan 01-07).
 *
 * Behaviour covered (PLAN.md `<behavior>` Tests 6–10):
 *  - Test 6: UserPromptSubmit payload → CanonicalEvent input with
 *           tool="claude-code", kind="prompt_submitted", payload.hook_event="UserPromptSubmit",
 *           prompt_text matches the input prompt.
 *  - Test 7: PostToolUse payload WITH usage object → all 4 token fields
 *           preserved separately, NO aggregation (A2 option c).
 *  - Test 8: PostToolUse payload WITHOUT usage → payload.usage is undefined
 *           (NOT zeroed).
 *  - Test 9: SessionStart, SessionEnd, PreCompact, SubagentStop → each maps
 *           to the correct EventKind.
 *  - Test 10: Unknown hook_event_name → throws (so registry counts parse_errors
 *            and drops the event per Pitfall 1).
 *
 * The 4-token preservation test is the load-bearing assertion for A2
 * option (c) — verbatim capture, no math. If anyone in the future tries
 * to add `total_input_tokens = input + cache_*`, this test will catch it.
 */

import { describe, expect, it } from "vitest";
import { HOOK_EVENT_TO_KIND, normalizeHookPayload } from "./payload-normaliser.js";

describe("normalizeHookPayload", () => {
  it("normalises a UserPromptSubmit payload into a CanonicalEvent input", () => {
    const raw = {
      hook_event_name: "UserPromptSubmit",
      session_id: "sess-1",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/Users/dev/proj",
      prompt: "What's the weather?",
    };

    const out = normalizeHookPayload(raw);

    expect(out.tool).toBe("claude-code");
    expect(out.adapter_version).toBe("0.1.0");
    expect(out.kind).toBe("prompt_submitted");
    expect(out.session_id).toBe("sess-1");
    expect(out.hook_event).toBe("UserPromptSubmit");
    expect(out.cwd).toBe("/Users/dev/proj");

    // The PAYLOAD object is what lives under CanonicalEvent.payload
    expect(out.payload.hook_event).toBe("UserPromptSubmit");
    expect(out.payload.session_id).toBe("sess-1");
    expect(out.payload.prompt_text).toBe("What's the weather?");
    expect(out.payload.cwd).toBe("/Users/dev/proj");
    expect(out.payload.usage).toBeUndefined();
  });

  it("preserves all 4 Anthropic Usage token fields VERBATIM — NO aggregation (A2 option c)", () => {
    const raw = {
      hook_event_name: "PostToolUse",
      session_id: "sess-2",
      tool: {
        name: "Read",
        response: {
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 75,
          },
        },
      },
    };

    const out = normalizeHookPayload(raw);

    expect(out.kind).toBe("tool_call");
    expect(out.payload.hook_event).toBe("PostToolUse");
    expect(out.payload.usage).toBeDefined();

    const usage = out.payload.usage as Record<string, unknown>;
    // All 4 fields present, verbatim
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.cache_creation_input_tokens).toBe(200);
    expect(usage.cache_read_input_tokens).toBe(75);

    // NO derived fields — A2 option (c) — the normaliser must NOT add
    // total_input_tokens or any aggregate.
    expect(usage).not.toHaveProperty("total_input_tokens");
    expect(usage).not.toHaveProperty("total");
    expect(usage).not.toHaveProperty("total_tokens");
    expect(Object.keys(usage)).toHaveLength(4);
  });

  it("PostToolUse WITHOUT usage → payload.usage is undefined (NOT zeroed)", () => {
    const raw = {
      hook_event_name: "PostToolUse",
      session_id: "sess-3",
      tool: { name: "Read" },
    };

    const out = normalizeHookPayload(raw);

    expect(out.kind).toBe("tool_call");
    expect(out.payload.usage).toBeUndefined();
  });

  it("maps all 6 D-22 hook events to the correct EventKind", () => {
    const cases: Array<[string, string]> = [
      ["UserPromptSubmit", "prompt_submitted"],
      ["PostToolUse", "tool_call"],
      ["SessionStart", "session_start"],
      ["SessionEnd", "session_end"],
      ["PreCompact", "pre_compact"],
      ["SubagentStop", "subagent_stop"],
    ];

    for (const [hookEventName, expectedKind] of cases) {
      const out = normalizeHookPayload({
        hook_event_name: hookEventName,
        session_id: "s",
      });
      expect(out.kind, `mapping for ${hookEventName}`).toBe(expectedKind);
      expect(out.payload.hook_event).toBe(hookEventName);
    }
  });

  it("throws on unknown hook_event_name (registry will count parse_errors per Pitfall 1)", () => {
    expect(() =>
      normalizeHookPayload({
        hook_event_name: "MysteriousNewHook",
        session_id: "s",
      }),
    ).toThrow();
  });

  it("throws when hook_event_name is missing", () => {
    expect(() =>
      normalizeHookPayload({
        session_id: "s",
      }),
    ).toThrow();
  });

  it("throws when session_id is missing", () => {
    expect(() =>
      normalizeHookPayload({
        hook_event_name: "UserPromptSubmit",
      }),
    ).toThrow();
  });

  it("HOOK_EVENT_TO_KIND covers all 6 D-22 hooks exhaustively", () => {
    expect(HOOK_EVENT_TO_KIND.UserPromptSubmit).toBe("prompt_submitted");
    expect(HOOK_EVENT_TO_KIND.PostToolUse).toBe("tool_call");
    expect(HOOK_EVENT_TO_KIND.SessionStart).toBe("session_start");
    expect(HOOK_EVENT_TO_KIND.SessionEnd).toBe("session_end");
    expect(HOOK_EVENT_TO_KIND.PreCompact).toBe("pre_compact");
    expect(HOOK_EVENT_TO_KIND.SubagentStop).toBe("subagent_stop");
    expect(Object.keys(HOOK_EVENT_TO_KIND)).toHaveLength(6);
  });

  it("UserPromptSubmit with empty prompt → payload.prompt_text is empty string (not undefined)", () => {
    const out = normalizeHookPayload({
      hook_event_name: "UserPromptSubmit",
      session_id: "s",
      // no prompt
    });
    expect(out.payload.prompt_text).toBe("");
  });
});
