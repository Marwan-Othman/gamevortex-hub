import {
  executeAiTool,
  getAiTool,
  getAiToolNames,
} from "./registry";

type SecurityTestResult = {
  name: string;
  passed: boolean;
  details?: string;
};

function pass(
  name: string,
  details?: string,
): SecurityTestResult {
  return {
    name,
    passed: true,
    details,
  };
}

function fail(
  name: string,
  details: string,
): SecurityTestResult {
  return {
    name,
    passed: false,
    details,
  };
}

/**
 * GameVortex AI Tool Security Tests
 *
 * These tests focus on the security boundary that can be
 * tested without requiring a live authenticated user.
 *
 * Authentication/database integration tests must be executed
 * through the application environment because the real session
 * and database are required for those checks.
 */
export async function runAiToolSecurityTests(): Promise<{
  ok: boolean;
  passed: number;
  failed: number;
  results: SecurityTestResult[];
}> {
  const results: SecurityTestResult[] = [];

  /*
   * Test 1:
   * Registry must contain only known GameVortex Tools.
   */
  const toolNames =
    getAiToolNames();

  const expectedTools = [
    "searchGames",
    "getGame",
    "searchMarketplace",
    "getProduct",
    "searchLibrary",
  ];

  const registryIsValid =
    expectedTools.every(
      (name) =>
        toolNames.includes(name),
    );

  if (registryIsValid) {
    results.push(
      pass(
        "Registry contains all expected tools",
      ),
    );
  } else {
    results.push(
      fail(
        "Registry contains all expected tools",
        `Missing tools: ${expectedTools
          .filter(
            (name) =>
              !toolNames.includes(name),
          )
          .join(", ")}`,
      ),
    );
  }

  /*
   * Test 2:
   * Unknown Tool names must never execute.
   */
  const unknownToolResult =
    await executeAiTool(
      "deleteDatabase",
      {},
    );

  if (
    typeof unknownToolResult ===
      "object" &&
    unknownToolResult !== null &&
    "ok" in unknownToolResult &&
    unknownToolResult.ok === false
  ) {
    results.push(
      pass(
        "Unknown Tool is rejected",
      ),
    );
  } else {
    results.push(
      fail(
        "Unknown Tool is rejected",
        "Unknown Tool execution was not rejected.",
      ),
    );
  }

  /*
   * Test 3:
   * Empty Tool name must be rejected.
   */
  const emptyNameResult =
    await executeAiTool(
      "",
      {},
    );

  if (
    typeof emptyNameResult ===
      "object" &&
    emptyNameResult !== null &&
    "ok" in emptyNameResult &&
    emptyNameResult.ok === false
  ) {
    results.push(
      pass(
        "Empty Tool name is rejected",
      ),
    );
  } else {
    results.push(
      fail(
        "Empty Tool name is rejected",
        "Empty Tool name was not rejected.",
      ),
    );
  }

  /*
   * Test 4:
   * Extremely long Tool names must be rejected.
   */
  const longName =
    "A".repeat(101);

  const longNameResult =
    await executeAiTool(
      longName,
      {},
    );

  if (
    typeof longNameResult ===
      "object" &&
    longNameResult !== null &&
    "ok" in longNameResult &&
    longNameResult.ok === false
  ) {
    results.push(
      pass(
        "Oversized Tool name is rejected",
      ),
    );
  } else {
    results.push(
      fail(
        "Oversized Tool name is rejected",
        "Oversized Tool name was not rejected.",
      ),
    );
  }

  /*
   * Test 5:
   * searchGames must reject invalid input.
   *
   * This test happens before database execution because
   * the Registry validates the Tool schema first.
   */
  const invalidSearchGames =
    await executeAiTool(
      "searchGames",
      {
        query: "",
      },
    );

  if (
    typeof invalidSearchGames ===
      "object" &&
    invalidSearchGames !== null &&
    "ok" in invalidSearchGames &&
    invalidSearchGames.ok === false
  ) {
    results.push(
      pass(
        "searchGames rejects invalid input",
      ),
    );
  } else {
    results.push(
      fail(
        "searchGames rejects invalid input",
        "Invalid searchGames input was not rejected.",
      ),
    );
  }

  /*
   * Test 6:
   * getGame must reject requests without id/slug.
   */
  const invalidGetGame =
    await executeAiTool(
      "getGame",
      {},
    );

  if (
    typeof invalidGetGame ===
      "object" &&
    invalidGetGame !== null &&
    "ok" in invalidGetGame &&
    invalidGetGame.ok === false
  ) {
    results.push(
      pass(
        "getGame rejects missing identifier",
      ),
    );
  } else {
    results.push(
      fail(
        "getGame rejects missing identifier",
        "getGame accepted an empty identifier object.",
      ),
    );
  }

  /*
   * Test 7:
   * getProduct must reject requests without id/SKU.
   */
  const invalidGetProduct =
    await executeAiTool(
      "getProduct",
      {},
    );

  if (
    typeof invalidGetProduct ===
      "object" &&
    invalidGetProduct !== null &&
    "ok" in invalidGetProduct &&
    invalidGetProduct.ok === false
  ) {
    results.push(
      pass(
        "getProduct rejects missing identifier",
      ),
    );
  } else {
    results.push(
      fail(
        "getProduct rejects missing identifier",
        "getProduct accepted an empty identifier object.",
      ),
    );
  }

  /*
   * Test 8:
   * searchMarketplace must reject invalid product kind.
   */
  const invalidMarketplaceKind =
    await executeAiTool(
      "searchMarketplace",
      {
        query: "steam",
        kind: "NOT_A_REAL_PRODUCT_KIND",
      },
    );

  if (
    typeof invalidMarketplaceKind ===
      "object" &&
    invalidMarketplaceKind !== null &&
    "ok" in invalidMarketplaceKind &&
    invalidMarketplaceKind.ok === false
  ) {
    results.push(
      pass(
        "searchMarketplace rejects invalid product kind",
      ),
    );
  } else {
    results.push(
      fail(
        "searchMarketplace rejects invalid product kind",
        "Invalid product kind was accepted.",
      ),
    );
  }

  /*
   * Test 9:
   * searchLibrary must reject an invalid library status.
   */
  const invalidLibraryStatus =
    await executeAiTool(
      "searchLibrary",
      {
        status: "NOT_A_REAL_STATUS",
      },
    );

  if (
    typeof invalidLibraryStatus ===
      "object" &&
    invalidLibraryStatus !== null &&
    "ok" in invalidLibraryStatus &&
    invalidLibraryStatus.ok === false
  ) {
    results.push(
      pass(
        "searchLibrary rejects invalid status",
      ),
    );
  } else {
    results.push(
      fail(
        "searchLibrary rejects invalid status",
        "Invalid library status was accepted.",
      ),
    );
  }

  /*
   * Test 10:
   * Pagination limits must reject values above 25.
   */
  const oversizedPagination =
    await executeAiTool(
      "searchGames",
      {
        query: "test",
        pagination: {
          page: 1,
          limit: 100000,
        },
      },
    );

  if (
    typeof oversizedPagination ===
      "object" &&
    oversizedPagination !== null &&
    "ok" in oversizedPagination &&
    oversizedPagination.ok === false
  ) {
    results.push(
      pass(
        "Oversized pagination is rejected",
      ),
    );
  } else {
    results.push(
      fail(
        "Oversized pagination is rejected",
        "Pagination above the configured maximum was accepted.",
      ),
    );
  }

  /*
   * Test 11:
   * Tool names must not expose internal database methods.
   */
  const forbiddenNames = [
    "findMany",
    "findFirst",
    "update",
    "delete",
    "deleteMany",
    "updateMany",
    "$queryRaw",
    "$executeRaw",
  ];

  const exposesDatabaseOperations =
    forbiddenNames.some(
      (name) =>
        toolNames.includes(name),
    );

  if (!exposesDatabaseOperations) {
    results.push(
      pass(
        "Registry does not expose raw database operations",
      ),
    );
  } else {
    results.push(
      fail(
        "Registry does not expose raw database operations",
        "A database operation was exposed as an AI Tool.",
      ),
    );
  }

  /*
   * Test 12:
   * Every expected Tool must have an executable definition.
   */
  const executableTools =
    expectedTools.every(
      (name) => {
        const tool =
          getAiTool(name);

        return Boolean(
          tool &&
          typeof tool.execute ===
            "function" &&
          tool.inputSchema,
        );
      },
    );

  if (executableTools) {
    results.push(
      pass(
        "Every registered Tool has validation and execution logic",
      ),
    );
  } else {
    results.push(
      fail(
        "Every registered Tool has validation and execution logic",
        "At least one registered Tool is incomplete.",
      ),
    );
  }

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
