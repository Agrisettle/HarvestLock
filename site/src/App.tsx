import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { Problem } from "./components/Problem";
import { HowItWorks } from "./components/HowItWorks";
import { WhyStellar } from "./components/WhyStellar";
import { Status } from "./components/Status";
import { Partners } from "./components/Partners";
import { Footer } from "./components/Footer";

function App() {
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Nav />
      {/* tabIndex=-1: an anchor jump to #main-content moves the browser's
          scroll position on its own, but not keyboard focus, unless the
          target is programmatically focusable -- without this, activating
          the skip link leaves focus stranded, defeating the point. */}
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <Problem />
        <HowItWorks />
        <WhyStellar />
        <Status />
        <Partners />
      </main>
      <Footer />
    </>
  );
}

export default App;
