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
      <Nav />
      <main>
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
