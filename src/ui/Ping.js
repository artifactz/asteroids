import { hideOnFadeout } from "./Hud.js";

const pingArrowContainer = document.getElementById('ping-arrow-container');

export function showPingArrow() {
    pingArrowContainer.style.display = "block";
    pingArrowContainer.classList.add("visible");
}

export function hidePingArrow() {
    pingArrowContainer.classList.remove("visible");
    hideOnFadeout(pingArrowContainer);
}

export function updatePingArrow(center, angle, radius = 70) {
    const x = center.x + radius * Math.cos(angle);
    const y = center.y + radius * Math.sin(angle);
    pingArrowContainer.style.left = `${x}px`;
    pingArrowContainer.style.top = `${y}px`;
    pingArrowContainer.style.transform = `translateX(-50%) translateY(-50%) rotate(${angle}rad)`;
}
