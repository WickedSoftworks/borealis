import { describe, expect, test } from "bun:test";
import { COMMAND, COMMANDS } from "./commands";

// Discord refuses the whole registration if any one of these rules is broken,
// so they are checked here rather than discovered at `discord-commands` time.
const NAME = /^[-_\p{Ll}\p{N}]{1,32}$/u;

describe("COMMANDS", () => {
  test("every handled command is registered, once", () => {
    const names = COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(Object.values(COMMAND).sort());
  });

  test("names and descriptions fit Discord's limits", () => {
    for (const command of COMMANDS) {
      expect(command.name).toMatch(NAME);
      expect(command.description.length).toBeLessThanOrEqual(100);

      const options = "options" in command ? command.options : [];
      expect(options.length).toBeLessThanOrEqual(25);

      for (const option of options) {
        expect(option.name).toMatch(NAME);
        expect(option.description.length).toBeLessThanOrEqual(100);
        if ("choices" in option) {
          expect(option.choices.length).toBeLessThanOrEqual(25);
        }
      }
    }
  });

  test("required options come before optional ones", () => {
    for (const command of COMMANDS) {
      const options = "options" in command ? command.options : [];
      const required = options.map(
        (option) => "required" in option && option.required === true,
      );
      expect(required).toEqual(
        [...required].sort((a, b) => Number(b) - Number(a)),
      );
    }
  });
});
