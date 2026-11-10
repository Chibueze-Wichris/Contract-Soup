import { Link } from "react-router-dom";
import { Card, buttonClasses } from "@/components/ui";

export default function NotFound() {
  return (
    <Card className="mx-auto mt-8 max-w-md text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">That address does not match anything in ContractSoup.</p>
      <Link to="/" className={buttonClasses("primary", "md", "mt-5")}>
        Back to dashboard
      </Link>
    </Card>
  );
}
