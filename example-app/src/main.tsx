import { locatorToUrl } from "@kinetic-router/url";
import { render } from "@solidjs/web";
import { homePage, postList, sitemap, userFriendList } from "./sitemap";

export default function App() {
  return (
    <main>
      <ul>
        <li><a href={locatorToUrl(sitemap, homePage.locate({}))}>home</a></li>
        <li><a href={locatorToUrl(sitemap, userFriendList.locate({ userId: 'abc' }))}>user abc's friends</a></li>
        <li><a href={locatorToUrl(sitemap, postList.locate({}))}>posts</a></li>
      </ul>
    </main>
  );
}

const root = document.getElementById('root');

render(() => <App />, root!);
