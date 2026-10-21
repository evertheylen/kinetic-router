import { Link } from "@kinetic-router/solid/link.js";
import { Fingerprint } from "@kinetic-router/testing-utils/fingerprint.js";
import { homePage } from "./sitemap.js";
import { TrainImage } from "./train-image.js";

export default {
  untrackedKeys: [],
  async render() {
    return () => {
      const html = <div>
        <h1>Account</h1>
        <Fingerprint />
        <TrainImage page="account" />
        <label>Account notes <input /></label>
        <p>Use the menu or Back/Forward to leave and return; cached pages keep their notes.</p>
        <Link route={homePage} mode="replace">Return home (replace this entry)</Link>
      </div>;

      return { html, title: 'account', description: 'Your account' };
    };
  },
};
