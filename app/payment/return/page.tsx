import PaymentReturnClient from "./PaymentReturnClient";

export const dynamic =
  "force-dynamic";

type SearchParams = Promise<{
  target?:
    | string
    | string[];
  reference?:
    | string
    | string[];
  token?:
    | string
    | string[];
}>;

function first(
  value:
    | string
    | string[]
    | undefined,
) {
  return Array.isArray(
    value,
  )
    ? value[0]
    : value;
}

export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params =
    await searchParams;

  const targetValue = first(params.target);
  const target =
    targetValue === "api"
      ? "api"
      : targetValue === "vip"
      ? "vip"
      : targetValue === "wallet"
        ? "wallet"
        : "orders";

  return (
    <PaymentReturnClient
      target={target}
      referenceId={
        first(
          params.reference,
        ) ?? null
      }
      paypalToken={
        first(
          params.token,
        ) ?? null
      }
    />
  );
}
