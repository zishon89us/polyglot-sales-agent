import { describe, expect, test } from "vitest";
import {
  type DeploymentFacts,
  PRODUCTION_REASONS,
  productionProblems,
  productionReasons,
  readEnvironment,
  refuseInProduction,
  startFailure,
  startReasons,
} from "./environment.ts";

const real: DeploymentFacts = {
  whatsappBaseUrl: "https://graph.facebook.com",
  secrets: { PSA_DB_APP_URL: "postgres://psa_app:Zx81-not-a-placeholder@db.internal/psa" },
};

describe("where a process runs", () => {
  test("is said by PSA_ENV, in one of two words", () => {
    expect(readEnvironment({ PSA_ENV: "development" })).toBe("development");
    expect(readEnvironment({ PSA_ENV: "production" })).toBe("production");
  });

  test.each([undefined, "", "prod", "Production", "production ", "staging", "toString"])(
    "has no default: %j is refused, and the value is not repeated",
    (value) => {
      const attempt = () => readEnvironment({ PSA_ENV: value });
      expect(attempt).toThrow("PSA_ENV must be set to development or production");
      if (
        value !== undefined &&
        value.trim() !== "" &&
        !"development or production".includes(value)
      ) {
        expect(attempt).not.toThrow(value);
      }
    },
  );
});

describe("why a program does not start, for a log line that carries no sentence (M3 unit U6)", () => {
  const facts = {
    developmentOnly: true,
    whatsappBaseUrl: "http://127.0.0.1:4010",
    secrets: { PSA_A: "local-only-x", PSA_B: "local-only-y" },
    sharedChannelCredential: true,
    standInModel: true,
  };

  test("each refusal has a short name, given once, in the order of the sentences", () => {
    expect(productionReasons("production", facts)).toEqual([
      "development-component",
      "stand-in-channel",
      "placeholder-secret",
      "stand-in-model",
      "shared-channel-credential",
    ]);
    expect(productionProblems("production", facts)).toHaveLength(6);
    expect(productionReasons("development", facts)).toEqual([]);
    expect(
      productionReasons("production", { whatsappBaseUrl: "https://graph.facebook.com" }),
    ).toEqual([]);
    expect([...PRODUCTION_REASONS].sort()).toEqual(
      [...productionReasons("production", facts)].sort(),
    );
  });

  test("a failure to start is an error with its sentence, a code and its reasons", () => {
    const failure = startFailure("api: PSA_X is not set", "settings");
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({ message: "api: PSA_X is not set", code: "settings" });
    expect(startReasons(failure)).toEqual([]);
    const reasons = ["stand-in-channel"];
    const refused = startFailure("no", "not-for-production", reasons);
    reasons.push("placeholder-secret");
    expect(startReasons(refused)).toEqual(["stand-in-channel"]);
    expect(startReasons(new Error("plain"))).toEqual([]);
    expect(startReasons(null)).toEqual([]);
    // Only reasons of the list are given, whatever an error carries.
    expect(
      startReasons({
        reasons: ["test-customer", 7, null, "shared-channel-credential", "stand-in-channel"],
      }),
    ).toEqual(["stand-in-channel", "shared-channel-credential"]);
    expect(startReasons({ reasons: "a" })).toEqual([]);
  });
});

describe("what production refuses (issue #165)", () => {
  test("nothing, when every fact is a real one", () => {
    expect(productionProblems("production", real)).toEqual([]);
  });

  test("nothing at all in development, whatever the facts", () => {
    expect(
      productionProblems("development", {
        developmentOnly: true,
        whatsappBaseUrl: "http://127.0.0.1:4010",
        secrets: { A: "local-only-x" },
        sharedChannelCredential: true,
      }),
    ).toEqual([]);
  });

  test("a development component", () => {
    expect(productionProblems("production", { developmentOnly: true })).toEqual([
      "this is a development component and has no place in production",
    ]);
  });

  test.each([
    "http://127.0.0.1:4010",
    "http://mock:4010",
    "http://graph.facebook.com",
    "https://graph.facebook.com.example.test",
    "https://example.test/graph.facebook.com",
    "https://user:word@graph.facebook.com",
    "https://user@graph.facebook.com",
    "https://:word@graph.facebook.com",
    "https://graph.facebook.com:8443",
    "https://graph.facebook.com.",
    "not a url",
    "",
  ])("a channel that is not Meta's own address over https: %j", (whatsappBaseUrl) => {
    expect(productionProblems("production", { whatsappBaseUrl })).toEqual([
      "PSA_WHATSAPP_BASE_URL is not https://graph.facebook.com, so the channel is a stand-in",
    ]);
  });

  test.each([
    "https://graph.facebook.com",
    "https://graph.facebook.com/",
    "https://GRAPH.facebook.com",
  ])("Meta's address is taken: %j", (whatsappBaseUrl) => {
    expect(productionProblems("production", { whatsappBaseUrl })).toEqual([]);
  });

  test("a placeholder secret from the example file, named and never shown", () => {
    const problems = productionProblems("production", {
      secrets: {
        PSA_DB_APP_URL: "postgres://psa_app:local-only-app@db/psa",
        PSA_WHATSAPP_APP_SECRET: "LOCAL-ONLY-app-signing-value",
        PSA_WHATSAPP_VERIFY_TOKEN: "a-real-one",
      },
    });
    expect(problems).toEqual([
      "PSA_DB_APP_URL holds a placeholder from the example file",
      "PSA_WHATSAPP_APP_SECRET holds a placeholder from the example file",
    ]);
    expect(problems.join(" ")).not.toMatch(/psa_app:|signing/);
  });

  test.each([
    "postgres://psa_app:local%2Donly-app@db/psa",
    // A stray percent sign elsewhere must not leave the rest undecoded.
    "postgres://psa_app:local%2Donly-app@db/psa?application_name=a%",
    "l%6Fcal%2donly%",
    "local_only-app-signing-value",
    "LocalOnly",
    "LOCAL ONLY",
    "x-local.only-y",
  ])("the mark is found however it is written: %j", (value) => {
    expect(productionProblems("production", { secrets: { A: value } })).toEqual([
      "A holds a placeholder from the example file",
    ]);
  });

  test("a value without the mark is not refused: the mark is a net for a copied example, not a test of a secret", () => {
    for (const value of ["postgres", "password", "Local-0nly-verify-value", "100%"]) {
      expect(productionProblems("production", { secrets: { A: value } })).toEqual([]);
    }
  });

  test("one channel credential for every tenant", () => {
    expect(productionProblems("production", { sharedChannelCredential: true })).toEqual([
      "the worker sends with one channel credential for every tenant, which is for development only",
    ]);
  });

  test("everything wrong is said together, in one refusal that names the process", () => {
    expect(() =>
      refuseInProduction("worker", "production", {
        whatsappBaseUrl: "http://mock:4010",
        secrets: { PSA_WHATSAPP_ACCESS_TOKEN: "local-only-mock-token" },
        sharedChannelCredential: true,
      }),
    ).toThrow(
      "worker: will not start in production: PSA_WHATSAPP_BASE_URL is not https://graph.facebook.com, so the channel is a stand-in; PSA_WHATSAPP_ACCESS_TOKEN holds a placeholder from the example file; the worker sends with one channel credential for every tenant, which is for development only",
    );
    expect(() => refuseInProduction("api", "production", real)).not.toThrow();
    expect(() => refuseInProduction("api", "development", { developmentOnly: true })).not.toThrow();
  });
});
