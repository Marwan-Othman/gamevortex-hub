import { db } from "@/lib/prisma";

const MAX_CONTEXT_CHARS = 18_000;

function clean(
  value: unknown,
  max = 800,
) {
  return typeof value === "string"
    ? value
        .replace(
          /[\u0000-\u001F]/g,
          " ",
        )
        .trim()
        .slice(0, max)
    : "";
}

function termsFromPrompt(
  prompt: string,
) {
  return Array.from(
    new Set(
      clean(prompt, 1200)
        .toLowerCase()
        .replace(
          /[^\p{L}\p{N}\s:_-]/gu,
          " ",
        )
        .split(/\s+/)
        .filter(
          (term) =>
            term.length >= 2,
        )
        .filter(
          (term) =>
            ![
              "ما",
              "ماذا",
              "كيف",
              "هل",
              "في",
              "من",
              "عن",
              "على",
              "the",
              "what",
              "how",
              "is",
              "are",
              "gamevortex",
              "ai",
            ].includes(term),
        )
        .slice(0, 8),
    ),
  );
}

function containsAny(
  prompt: string,
  values: string[],
) {
  const normalized =
    prompt.toLowerCase();

  return values.some(
    (value) =>
      normalized.includes(value),
  );
}

function money(
  cents: number,
  currency: string,
) {
  return `${(
    cents / 100
  ).toFixed(2)} ${currency}`;
}

export async function buildGameVortexSiteContext(
  userId: string,
  prompt: string,
) {
  const terms =
    termsFromPrompt(prompt);

  const wantsSiteContext =
    terms.length > 0 ||
    containsAny(prompt, [
      "gamevortex",
      "جيم فورتكس",
      "الموقع",
      "المتجر",
      "اللعبة",
      "الألعاب",
      "التطبيق",
      "التطبيقات",
      "المنتج",
      "المنتجات",
      "vip",
      "اشتراك",
      "محفظة",
      "رصيد",
      "نقاط",
      "طلب",
      "طلبات",
      "مكتبة",
      "library",
      "marketplace",
      "wallet",
      "points",
      "orders",
      "store",
      "games",
      "apps",
      "mods",
      "raffle",
      "referral",
    ]);

  // Generic conversation does not need a database-wide GameVortex snapshot.
  // Skipping it avoids several PostgreSQL queries and keeps normal chat fast.
  if (!wantsSiteContext) return "";

  const containsTerms =
    terms.length > 0;

  const gameWhere =
    containsTerms
      ? {
          published: true,

          OR: terms.flatMap(
            (term) => [
              {
                titleAr: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                titleEn: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                slug: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                genre: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                description: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
            ],
          ),
        }
      : {
          published: true,
          featured: true,
        };

  const appWhere =
    containsTerms
      ? {
          published: true,

          OR: terms.flatMap(
            (term) => [
              {
                nameAr: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                nameEn: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                slug: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                developer: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                descriptionAr: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
              {
                descriptionEn: {
                  contains:
                    term,
                  mode: "insensitive" as const,
                },
              },
            ],
          ),
        }
      : {
          published: true,
          featured: true,
        };

  const productWhere =
    containsTerms
      ? {
          active: true,
          supplierVerified: true,

          game: {
            published: true,

            OR: terms.flatMap(
              (term) => [
                {
                  titleAr: {
                    contains:
                      term,
                    mode: "insensitive" as const,
                  },
                },
                {
                  titleEn: {
                    contains:
                      term,
                    mode: "insensitive" as const,
                  },
                },
                {
                  slug: {
                    contains:
                      term,
                    mode: "insensitive" as const,
                  },
                },
              ],
            ),
          },
        }
      : {
          active: true,
          supplierVerified: true,
        };

  const wantsUser =
    containsAny(prompt, [
      "نقاط",
      "رصيدي",
      "حسابي",
      "vip",
      "اشتراكي",
      "عضويتي",
      "محفظتي",
      "طلباتي",
      "مكتبتي",
      "points",
      "my account",
      "my vip",
      "my wallet",
      "my orders",
      "my library",
    ]);

  const wantsRaffles =
    containsAny(prompt, [
      "سحب",
      "السحوبات",
      "raffle",
      "draw",
    ]);

  const wantsReferrals =
    containsAny(prompt, [
      "إحالة",
      "الإحالات",
      "referral",
      "referrals",
    ]);

  const wantsMods =
    containsAny(prompt, [
      "mod",
      "mods",
      "مود",
      "مودات",
    ]);

  const [
    games,
    apps,
    products,
    vipPlans,
    openRaffles,
    mods,
    user,
    counts,
  ] = await Promise.all([
    db.game.findMany({
      where: gameWhere,
      take: containsTerms
        ? 10
        : 8,
      orderBy: [
        {
          featured:
            "desc",
        },
        {
          ratingAverage:
            "desc",
        },
        {
          viewCount:
            "desc",
        },
      ],

      select: {
        slug: true,
        titleAr: true,
        titleEn: true,
        description: true,
        genre: true,
        priceCents: true,
        coverUrl: true,
        officialUrl: true,
        sourceStatus: true,
        ratingAverage: true,

        gamePlatforms: {
          select: {
            platform: true,
          },
        },
      },
    }),

    db.app.findMany({
      where: appWhere,
      take: containsTerms
        ? 10
        : 8,
      orderBy: [
        {
          featured:
            "desc",
        },
        {
          ratingAverage:
            "desc",
        },
        {
          viewCount:
            "desc",
        },
      ],

      select: {
        slug: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        developer: true,
        priceCents: true,
        officialUrl: true,
        sourceStatus: true,
        ratingAverage: true,

        appPlatforms: {
          select: {
            platform: true,
          },
        },
      },
    }),

    db.gameProduct.findMany({
      where: productWhere,
      take: containsTerms
        ? 10
        : 8,
      orderBy: {
        createdAt:
          "desc",
      },

      select: {
        sku: true,
        title: true,
        description: true,
        priceCents: true,
        currency: true,
        region: true,
        country: true,
        provider: true,

        game: {
          select: {
            slug: true,
            titleAr: true,
            titleEn: true,
          },
        },
      },
    }),

    db.vipPlan.findMany({
      where: {
        active: true,
      },

      orderBy: {
        sortOrder:
          "asc",
      },

      select: {
        code: true,
        nameAr: true,
        nameEn: true,
        descriptionAr: true,
        descriptionEn: true,
        priceCents: true,
        currency: true,
        durationMonths: true,
        pointsMultiplier: true,
      },
    }),

    wantsRaffles
      ? db.raffle.findMany({
          where: {
            status: "OPEN",
          },

          take: 10,

          orderBy: {
            createdAt:
              "desc",
          },

          select: {
            id: true,
            title: true,
            description: true,
            prize: true,
            ticketCost: true,
            maxEntries: true,
            drawAt: true,
          },
        })
      : Promise.resolve([]),

    wantsMods
      ? db.mod.findMany({
          where: {
            published: true,
          },

          take: 12,

          orderBy: [
            {
              featured:
                "desc",
            },
            {
              sortOrder:
                "asc",
            },
            {
              createdAt:
                "desc",
            },
          ],

          select: {
            slug: true,
            titleAr: true,
            titleEn: true,
            descriptionAr: true,
            descriptionEn: true,
            downloadUrl: true,
            modUrl: true,
            platform: true,
            sourceStatus: true,

            game: {
              select: {
                titleAr: true,
                titleEn: true,
              },
            },
          },
        })
      : Promise.resolve([]),

    wantsUser
      ? db.user.findUnique({
          where: {
            id: userId,
          },

          select: {
            points: true,
            vipTier: true,

            wallet: {
              select: {
                balance: true,
              },
            },

            vipSubscriptions: {
              where: {
                status: "ACTIVE",
              },

              orderBy: {
                expiresAt:
                  "desc",
              },

              take: 1,

              select: {
                expiresAt: true,

                plan: {
                  select: {
                    code: true,
                    nameAr: true,
                    nameEn: true,
                    pointsMultiplier: true,
                  },
                },
              },
            },

            _count: {
              select: {
                library: true,
                orders: true,
                referralsMade: true,
                raffleEntries: true,
              },
            },
          },
        })
      : Promise.resolve(null),

    Promise.all([
      db.game.count({
        where: {
          published: true,
        },
      }),

      db.app.count({
        where: {
          published: true,
        },
      }),

      db.gameProduct.count({
        where: {
          active: true,
          supplierVerified: true,
        },
      }),

      db.mod.count({
        where: {
          published: true,
        },
      }),
    ]),
  ]);

  const lines: string[] = [
    "GAMEVORTEX INTERNAL KNOWLEDGE SNAPSHOT",

    "Use this data as the authoritative source for questions about the GameVortex site.",

    "Do not invent GameVortex features, prices, products, games, balances, or URLs. If the snapshot does not contain the requested fact, say that the information is not available in the current site data.",

    "Public sections: Home, Games, Apps, Marketplace, Library, AI, VIP, Tasks, Referrals, Draws, Profile, Statistics, and Owner/Admin areas.",

    `Published games: ${counts[0]}`,

    `Published apps: ${counts[1]}`,

    `Active verified marketplace products: ${counts[2]}`,

    `Published mods: ${counts[3]}`,
  ];

  if (games.length) {
    lines.push(
      "\nMATCHING GAMES:",
    );

    for (const game of games) {
      lines.push(
        `- ${clean(game.titleAr)} / ${clean(game.titleEn)} | slug=${clean(game.slug)} | genre=${clean(game.genre)} | price=${money(game.priceCents, "USD")} | rating=${game.ratingAverage.toFixed(1)} | platforms=${game.gamePlatforms.map((p) => p.platform).join(", ")} | source=${game.sourceStatus} | official=${clean(game.officialUrl, 300)}`,
      );
    }
  }

  if (apps.length) {
    lines.push(
      "\nMATCHING APPS:",
    );

    for (const app of apps) {
      lines.push(
        `- ${clean(app.nameAr)} / ${clean(app.nameEn)} | slug=${clean(app.slug)} | developer=${clean(app.developer)} | price=${money(app.priceCents, "USD")} | rating=${app.ratingAverage.toFixed(1)} | platforms=${app.appPlatforms.map((p) => p.platform).join(", ")} | source=${app.sourceStatus} | official=${clean(app.officialUrl, 300)}`,
      );
    }
  }

  if (products.length) {
    lines.push(
      "\nMATCHING MARKETPLACE PRODUCTS:",
    );

    for (const product of products) {
      lines.push(
        `- ${clean(product.title)} | sku=${clean(product.sku)} | game=${clean(product.game.titleAr)} / ${clean(product.game.titleEn)} | price=${money(product.priceCents, product.currency)} | region=${clean(product.region)} | country=${clean(product.country)} | provider=${clean(product.provider)}`,
      );
    }
  }

  if (mods.length) {
    lines.push(
      "\nMATCHING MODS:",
    );

    for (const mod of mods) {
      lines.push(
        `- ${clean(mod.titleAr)} / ${clean(mod.titleEn)} | slug=${clean(mod.slug)} | game=${clean(mod.game?.titleAr)} / ${clean(mod.game?.titleEn)} | platform=${clean(mod.platform)} | source=${mod.sourceStatus} | modUrl=${clean(mod.modUrl, 300)} | download=${clean(mod.downloadUrl, 300)}`,
      );
    }
  }

  if (vipPlans.length) {
    lines.push(
      "\nACTIVE VIP PLANS:",
    );

    for (const plan of vipPlans) {
      lines.push(
        `- ${clean(plan.nameAr)} / ${clean(plan.nameEn)} | code=${clean(plan.code)} | price=${money(plan.priceCents, plan.currency)} | durationMonths=${plan.durationMonths ?? "permanent"} | pointsMultiplier=${String(plan.pointsMultiplier)} | description=${clean(plan.descriptionAr || plan.descriptionEn, 500)}`,
      );
    }
  }

  if (openRaffles.length) {
    lines.push(
      "\nOPEN DRAWS:",
    );

    for (const raffle of openRaffles) {
      lines.push(
        `- ${clean(raffle.title)} | prize=${clean(raffle.prize)} | ticketCost=${raffle.ticketCost} points | drawAt=${raffle.drawAt?.toISOString() || "-"}`,
      );
    }
  }

  if (wantsUser && user) {
    lines.push(
      "\nCURRENT USER CONTEXT (PRIVATE, DO NOT REVEAL SENSITIVE ACCOUNT DATA):",
    );

    lines.push(
      `- points=${user.points}`,
    );

    lines.push(
      `- vipTier=${user.vipTier}`,
    );

    lines.push(
      `- walletBalance=${
        user.wallet
          ? `${user.wallet.balance.toString()} USD`
          : "not available"
      }`,
    );

    lines.push(
      `- activeVip=${
        user.vipSubscriptions[0]
          ? `${clean(
              user.vipSubscriptions[0].plan.nameAr,
            )} / ${clean(
              user.vipSubscriptions[0].plan.nameEn,
            )} until ${
              user.vipSubscriptions[0].expiresAt?.toISOString() ||
              "permanent"
            }`
          : "none"
      }`,
    );

    lines.push(
      `- libraryItems=${user._count.library}`,
    );

    lines.push(
      `- orders=${user._count.orders}`,
    );

    lines.push(
      `- referrals=${user._count.referralsMade}`,
    );

    lines.push(
      `- raffleEntries=${user._count.raffleEntries}`,
    );
  }

  if (wantsReferrals) {
    lines.push(
      "REFERRALS: GameVortex contains a referral system tied to the user's referral code and referral records. Give exact reward amounts only when they are present in current site data; do not invent them.",
    );
  }

  return lines
    .join("\n")
    .slice(
      0,
      MAX_CONTEXT_CHARS,
    );
}
