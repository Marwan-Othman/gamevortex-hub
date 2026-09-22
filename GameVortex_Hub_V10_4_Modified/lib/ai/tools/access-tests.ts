import {
  executeAiTool,
} from "./registry";

type AccessTestResult = {
  name: string;
  passed: boolean;
  details: string;
};

function createResult(
  name: string,
  passed: boolean,
  details: string,
): AccessTestResult {
  return {
    name,
    passed,
    details,
  };
}

function isUnauthorizedResult(
  value: unknown,
): boolean {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  if (
    !("ok" in value) ||
    value.ok !== false
  ) {
    return false;
  }

  if (
    !("error" in value) ||
    typeof value.error !== "object" ||
    value.error === null
  ) {
    return false;
  }

  if (
    !("code" in value.error)
  ) {
    return false;
  }

  return (
    value.error.code ===
    "UNAUTHORIZED"
  );
}

/**
 * Access-control security checks for GameVortex AI Tools.
 *
 * These checks intentionally use the real Tool execution path.
 * No mock user, fake session or fake authorization result is
 * introduced here.
 *
 * The test environment must therefore have no authenticated
 * GameVortex session when these tests are executed.
 */
export async function runAiToolAccessTests(): Promise<{
  ok: boolean;
  passed: number;
  failed: number;
  results: AccessTestResult[];
}> {
  const results: AccessTestResult[] = [];

  /*
   * Test 1:
   * searchGames requires authentication.
   */
  const searchGamesResult =
    await executeAiTool(
      "searchGames",
      {
        query: "minecraft",
      },
    );

  results.push(
    createResult(
      "searchGames requires authentication",
      isUnauthorizedResult(
        searchGamesResult,
      ),
      isUnauthorizedResult(
        searchGamesResult,
      )
        ? "Unauthenticated access was rejected."
        : "searchGames executed without an authenticated user.",
    ),
  );

  /*
   * Test 2:
   * getGame requires authentication.
   */
  const getGameResult =
    await executeAiTool(
      "getGame",
      {
        slug: "minecraft",
      },
    );

  results.push(
    createResult(
      "getGame requires authentication",
      isUnauthorizedResult(
        getGameResult,
      ),
      isUnauthorizedResult(
        getGameResult,
      )
        ? "Unauthenticated access was rejected."
        : "getGame executed without an authenticated user.",
    ),
  );

  /*
   * Test 3:
   * searchMarketplace requires authentication.
   */
  const marketplaceResult =
    await executeAiTool(
      "searchMarketplace",
      {
        query: "steam",
      },
    );

  results.push(
    createResult(
      "searchMarketplace requires authentication",
      isUnauthorizedResult(
        marketplaceResult,
      ),
      isUnauthorizedResult(
        marketplaceResult,
      )
        ? "Unauthenticated access was rejected."
        : "searchMarketplace executed without an authenticated user.",
    ),
  );

  /*
   * Test 4:
   * getProduct requires authentication.
   */
  const getProductResult =
    await executeAiTool(
      "getProduct",
      {
        sku: "test-product",
      },
    );

  results.push(
    createResult(
      "getProduct requires authentication",
      isUnauthorizedResult(
        getProductResult,
      ),
      isUnauthorizedResult(
        getProductResult,
      )
        ? "Unauthenticated access was rejected."
        : "getProduct executed without an authenticated user.",
    ),
  );

  /*
   * Test 5:
   * searchLibrary requires authentication.
   */
  const libraryResult =
    await executeAiTool(
      "searchLibrary",
      {
        query: "minecraft",
      },
    );

  results.push(
    createResult(
      "searchLibrary requires authentication",
      isUnauthorizedResult(
        libraryResult,
      ),
      isUnauthorizedResult(
        libraryResult,
      )
        ? "Unauthenticated access was rejected."
        : "searchLibrary executed without an authenticated user.",
    ),
  );

  /*
   * Test 6:
   * searchLibrary must not accept userId as an input field.
   *
   * The Tool schema intentionally contains only:
   * - query
   * - status
   * - pagination
   *
   * Sending userId must therefore be rejected by the schema.
   */
  const userIdInjectionResult =
    await executeAiTool(
      "searchLibrary",
      {
        userId:
          "another-users-id",
      },
    );

  const userIdRejected =
    !isUnauthorizedResult(
      userIdInjectionResult,
    ) &&
    typeof userIdInjectionResult ===
      "object" &&
    userIdInjectionResult !== null &&
    "ok" in userIdInjectionResult &&
    userIdInjectionResult.ok === false;

  results.push(
    createResult(
      "searchLibrary rejects injected userId",
      userIdRejected,
      userIdRejected
        ? "userId cannot be supplied through Tool input."
        : "searchLibrary accepted an injected userId.",
    ),
  );

  /*
   * Test 7:
   * searchLibrary must not accept arbitrary ownership fields.
   */
  const ownershipInjectionResult =
    await executeAiTool(
      "searchLibrary",
      {
        ownerId:
          "another-users-id",
        accountId:
          "another-users-id",
      },
    );

  const ownershipRejected =
    !isUnauthorizedResult(
      ownershipInjectionResult,
    ) &&
    typeof ownershipInjectionResult ===
      "object" &&
    ownershipInjectionResult !== null &&
    "ok" in ownershipInjectionResult &&
    ownershipInjectionResult.ok === false;

  results.push(
    createResult(
      "searchLibrary rejects ownership injection",
      ownershipRejected,
      ownershipRejected
        ? "Ownership identifiers cannot be supplied through Tool input."
        : "Ownership identifiers were accepted.",
    ),
  );

  /*
   * Test 8:
   * A Tool must never receive an arbitrary role from AI input.
   */
  const roleInjectionResult =
    await executeAiTool(
      "searchLibrary",
      {
        role:
          "SUPER_ADMIN",
        isAdmin:
          true,
        bypassAuth:
          true,
      },
    );

  const roleRejected =
    !isUnauthorizedResult(
      roleInjectionResult,
    ) &&
    typeof roleInjectionResult ===
      "object" &&
    roleInjectionResult !== null &&
    "ok" in roleInjectionResult &&
    roleInjectionResult.ok === false;

  results.push(
    createResult(
      "AI cannot inject authorization fields",
      roleRejected,
      roleRejected
        ? "Role and authorization fields are not accepted by the Tool schema."
        : "Authorization fields were accepted.",
    ),
  );

  /*
   * Test 9:
   * Database query operators must never be accepted as
   * raw input objects.
   */
  const rawOperatorInjectionResult =
    await executeAiTool(
      "searchGames",
      {
        query: {
          contains:
            "anything",
        },
      },
    );

  const rawOperatorRejected =
    typeof rawOperatorInjectionResult ===
      "object" &&
    rawOperatorInjectionResult !== null &&
    "ok" in rawOperatorInjectionResult &&
    rawOperatorInjectionResult.ok === false;

  results.push(
    createResult(
      "Raw database operators are rejected",
      rawOperatorRejected,
      rawOperatorRejected
        ? "Prisma query operators cannot be injected through Tool input."
        : "A raw database operator was accepted.",
    ),
  );

  const passed =
    results.filter(
      (result) =>
        result.passed,
    ).length;

  const failed =
    results.length - passed;

  return {
    ok: failed === 0,
    passed,
    failed,
    results,
  };
}
