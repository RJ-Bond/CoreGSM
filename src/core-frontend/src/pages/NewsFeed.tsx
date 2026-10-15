import { NewsArticlePage, NewsListPage } from '../components/news/NewsPublicPages';

/** read-only feed for players and guests: the list (/news) or one news item (/news/<id>); kept apart from the
 *  admin's news pages so that players do not download the editor */
export default function NewsFeed({ sub = '' }: { sub?: string }) {
  const id = Number(sub.split('/')[0]);
  if (sub && Number.isInteger(id) && id > 0) return <NewsArticlePage id={id} />;
  return <NewsListPage />;
}
