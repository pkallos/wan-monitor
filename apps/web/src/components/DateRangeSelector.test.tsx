import { ChakraProvider } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangeSelector } from "@/components/DateRangeSelector";

const renderWithChakra = (ui: React.ReactElement) => {
  return render(<ChakraProvider>{ui}</ChakraProvider>);
};

describe("DateRangeSelector", () => {
  it("should render all time range buttons", () => {
    const onChange = vi.fn();
    renderWithChakra(<DateRangeSelector value="24h" onChange={onChange} />);

    expect(screen.getByText("1 Hour")).toBeInTheDocument();
    expect(screen.getByText("24 Hours")).toBeInTheDocument();
    expect(screen.getByText("7 Days")).toBeInTheDocument();
    expect(screen.getByText("30 Days")).toBeInTheDocument();
  });

  it("should highlight the selected range", () => {
    const onChange = vi.fn();
    renderWithChakra(<DateRangeSelector value="7d" onChange={onChange} />);

    const sevenDaysButton = screen.getByText("7 Days");
    const oneDayButton = screen.getByText("24 Hours");

    expect(sevenDaysButton).toBeInTheDocument();
    expect(oneDayButton).toBeInTheDocument();
  });

  it("should call onChange when a button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithChakra(<DateRangeSelector value="24h" onChange={onChange} />);

    const sevenDaysButton = screen.getByText("7 Days");
    await user.click(sevenDaysButton);

    expect(onChange).toHaveBeenCalledWith("7d");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("should call onChange with correct values for each button", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithChakra(<DateRangeSelector value="24h" onChange={onChange} />);

    await user.click(screen.getByText("1 Hour"));
    expect(onChange).toHaveBeenLastCalledWith("1h");

    await user.click(screen.getByText("24 Hours"));
    expect(onChange).toHaveBeenLastCalledWith("24h");

    await user.click(screen.getByText("7 Days"));
    expect(onChange).toHaveBeenLastCalledWith("7d");

    await user.click(screen.getByText("30 Days"));
    expect(onChange).toHaveBeenLastCalledWith("30d");

    expect(onChange).toHaveBeenCalledTimes(4);
  });

  it("should not call onChange when clicking the already selected button", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithChakra(<DateRangeSelector value="24h" onChange={onChange} />);

    const selectedButton = screen.getByText("24 Hours");
    await user.click(selectedButton);

    expect(onChange).toHaveBeenCalledWith("24h");
  });
});
