import { Link } from "react-router-dom";
export default function NotFound() {
  return <div className="py-16 text-center"><h1 className="text-2xl font-bold">Page not found</h1><Link to="/" className="text-accent">Back to games</Link></div>;
}
