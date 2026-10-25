import { Link } from "react-router-dom";
export default function NotFound() {
  return <div className="py-16 text-center"><h1 className="text-2xl font-bold">Page not found</h1><p className="mt-3"><Link to="/" className="inline-flex min-h-11 items-center px-2 text-accent underline underline-offset-4">Back to games</Link></p></div>;
}
