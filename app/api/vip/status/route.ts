import {
  NextRequest,
  NextResponse,
} from "next/server";

import { requireUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import {
  getVipSubscriptionStatus,
} from "@/lib/vip-subscriptions";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  const blocked =
    await guardRead(
      request,
      "vip:status",
      60,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const status =
      await getVipSubscriptionStatus(
        user.id,
      );

    return NextResponse.json({
      success: true,
      data: status,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "VIP_STATUS_FAILED";

    if (
      message ===
      "UNAUTHORIZED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "UNAUTHORIZED",
        },
        {
          status: 401,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "VIP_STATUS_FAILED",
      },
      {
        status: 500,
      },
    );
  }
}
