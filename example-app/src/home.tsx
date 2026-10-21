import { Fingerprint } from "@kinetic-router/testing-utils/fingerprint.js";
import { router } from "./routing.js";
import { homePage } from "./sitemap.js";
import { TrainImage } from "./train-image.js";
import { TransientDialogDemo } from "./transient-dialog.js";

router.implement(homePage, {
  untrackedKeys: [],
  viewAs: 'mainpage',
  async render() {
    return () => {
      const html = <div>
        <h1>Welcome to the homepage!</h1>
        <Fingerprint />
        <TransientDialogDemo />
        <TrainImage page="home" />
      </div>;

      return { html, title: 'home', description: 'This is home' };
    }
  },
})

