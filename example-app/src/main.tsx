import { render } from "@solidjs/web";

import { agencyList, homePage, serviceBrandList, sitemap, trainList,  } from "./sitemap.js";
import { router } from "./routing.js";
import "./routes.js";
import { Frame } from "@kinetic-router/solid/frame.js";

export default function App() {
  console.log("this is App", { router });
  return (
    <main>
      <ul>
        <li><a href={router.toUrl(homePage.locate({}))}>home</a></li>
        <li><a href={router.toUrl(sitemap.account.locate({}))}>account</a></li>
        {/* <li><a href={router.toUrl(agencyList.locate({}))}>all agencies</a></li>
        <li><a href={router.toUrl(serviceBrandList.locate({ agencyId: 'NMBS' }))}>NMBS</a></li>
        <li><a href={router.toUrl(trainList.locate({ agencyId: 'NMBS', serviceBrand: 'IC' }))}>NMBS IC</a></li> */}
      </ul>
      <Frame component="div"/>
    </main>
  );
}

const root = document.getElementById('root');

render(() => <App />, root!);
