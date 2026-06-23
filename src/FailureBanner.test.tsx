import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FailureBanner } from "./FailureBanner";

describe("FailureBanner", () => {
  it("renders nothing when there are no failures", () => {
    const { container } = render(
      <FailureBanner failures={[]} total={5} onRetry={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the failed count out of total, collapsed by default", () => {
    render(
      <FailureBanner
        failures={[{ name: "Stripe", message: "HTTP error! status: 404" }]}
        total={16}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/1 of 16 services failed/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/HTTP error! status: 404/),
    ).not.toBeInTheDocument();
  });

  it("expands to show messages and fires onRetry with the service name", () => {
    const onRetry = vi.fn();
    render(
      <FailureBanner
        failures={[{ name: "Stripe", message: "HTTP error! status: 404" }]}
        total={16}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/HTTP error! status: 404/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry stripe/i }));
    expect(onRetry).toHaveBeenCalledWith("Stripe");
  });
});
