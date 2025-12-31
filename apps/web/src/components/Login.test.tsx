import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestWrapper } from "@/test/utils";
import { Login } from "./Login";

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockCheckAuth = vi.fn();

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: false,
    isLoading: false,
    username: null,
    authRequired: true,
    login: mockLogin,
    logout: mockLogout,
    checkAuth: mockCheckAuth,
  }),
}));

const renderLogin = () => {
  return render(<Login />, { wrapper: createTestWrapper() });
};

describe("Login Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders login form", () => {
    renderLogin();

    expect(screen.getByText("WAN Monitor")).toBeInTheDocument();
    expect(
      screen.getByText("Sign in to access the dashboard")
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter username/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/enter password/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /sign in/i })
    ).toBeInTheDocument();
  });

  it("allows user to type in username field", async () => {
    const user = userEvent.setup();
    renderLogin();

    const usernameInput = screen.getByPlaceholderText(/enter username/i);
    await user.type(usernameInput, "admin");

    expect(usernameInput).toHaveValue("admin");
  });

  it("allows user to type in password field", async () => {
    const user = userEvent.setup();
    renderLogin();

    const passwordInput = screen.getByPlaceholderText(/enter password/i);
    await user.type(passwordInput, "testpassword");

    expect(passwordInput).toHaveValue("testpassword");
  });

  it("has password visibility toggle", async () => {
    const user = userEvent.setup();
    renderLogin();

    const passwordInput = screen.getByPlaceholderText(/enter password/i);
    expect(passwordInput).toHaveAttribute("type", "password");

    const toggleButton = screen.getByLabelText(/show password/i);
    await user.click(toggleButton);

    expect(passwordInput).toHaveAttribute("type", "text");
  });

  it("calls login function on form submit", async () => {
    const user = userEvent.setup();
    renderLogin();

    const usernameInput = screen.getByPlaceholderText(/enter username/i);
    const passwordInput = screen.getByPlaceholderText(/enter password/i);
    const submitButton = screen.getByRole("button", { name: /sign in/i });

    await user.type(usernameInput, "admin");
    await user.type(passwordInput, "testpassword");
    await user.click(submitButton);

    expect(mockLogin).toHaveBeenCalledWith("admin", "testpassword");
  });
});
