import { NewsFeed } from "@/components/news/NewsFeed";

export const metadata = {
  title: "News & Updates — EquiCurve",
  description: "Creator-authored updates across EquiCurve markets.",
};

export default function NewsPage() {
  return <NewsFeed />;
}
