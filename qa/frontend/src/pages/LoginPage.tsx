import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { ApiRequestError } from "@/lib/apiClient";
import { Button, Field } from "@/components/ui";

export function LoginPage({ register = false }: { register?: boolean }) {
  const { login, register: doRegister } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ??
    "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (register) {
        await doRegister({
          email,
          password,
          full_name: fullName,
          organization_name: orgName || undefined,
        });
      } else {
        await login(email, password);
      }
      navigate(from, { replace: true });
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? err.message
          : "Authentication failed. Please try again.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-bg)",
        padding: "var(--space-6)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
        }}
      >
        <div style={{ marginBottom: "var(--space-6)", textAlign: "center" }}>
          <span
            className="sidebar__brand-mark"
            style={{ width: 40, height: 40, fontSize: 20, margin: "0 auto 12px" }}
          >
            Q
          </span>
          <h1 style={{ fontSize: "var(--font-2xl)" }}>
            {register ? "Create your workspace" : "Sign in to QA"}
          </h1>
          <p className="text-muted" style={{ marginTop: "var(--space-2)" }}>
            Quality Assurance &amp; Test Intelligence platform
          </p>
        </div>

        <div className="panel">
          <form className="panel__body space-y-3" onSubmit={onSubmit}>
            {register ? (
              <>
                <Field label="Full name" required>
                  <input
                    className="input"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                    required
                  />
                </Field>
                <Field label="Organization name" help="Leave blank to use a default.">
                  <input
                    className="input"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    autoComplete="organization"
                  />
                </Field>
              </>
            ) : null}
            <Field label="Email" required>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Password" required>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={register ? "new-password" : "current-password"}
                required
              />
            </Field>

            {error ? (
              <div className="text-danger text-sm" role="alert">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              style={{ width: "100%" }}
            >
              {register ? "Create account" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="text-sm text-muted" style={{ textAlign: "center", marginTop: "var(--space-4)" }}>
          {register ? (
            <>
              Already have an account?{" "}
              <Link to="/login">Sign in</Link>
            </>
          ) : (
            <>
              New here? <Link to="/register">Create an account</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
