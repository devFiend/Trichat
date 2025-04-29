let menuBar = document.getElementById('menu-bar');
let closeBar = document.getElementById('close-bar');
let nav = document.getElementById('nav');

menuBar.addEventListener('click', () => {
    nav.classList.toggle('add');
});

closeBar.addEventListener('click', () => {
    nav.classList.remove('add');
});