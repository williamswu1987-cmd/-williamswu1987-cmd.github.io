document.getElementById("year").textContent = String(new Date().getFullYear());

const sections = document.querySelectorAll(".section");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  sections.forEach((section) => {
    section.classList.add("will-reveal");
    observer.observe(section);
  });
} else {
  sections.forEach((section) => section.classList.add("is-visible"));
}
