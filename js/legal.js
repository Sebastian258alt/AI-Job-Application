// Páginas legais: escolhe PT/EN (?lang=, escolha guardada ou PT). Ficheiro externo porque a CSP não permite scripts inline.
(function(){var L="pt";try{var q=new URLSearchParams(location.search).get("lang");if(q=="en"||q=="pt")L=q;else{var s=localStorage.getItem("applypro-lang");if(s=="en")L="en"}}catch(e){}
function apply(l){L=l;document.documentElement.setAttribute("data-l",l);document.documentElement.lang=l=="en"?"en":"pt-MZ";
var b=document.querySelectorAll("[data-lang]");for(var i=0;i<b.length;i++)b[i].setAttribute("aria-pressed",String(b[i].getAttribute("data-lang")==l));
var h=document.querySelectorAll("[data-home]");for(var j=0;j<h.length;j++)h[j].href="/";document.title=(l=="en"?document.body.getAttribute("data-title-en"):document.body.getAttribute("data-title-pt"))}
document.addEventListener("click",function(e){var el=e.target.closest&&e.target.closest("[data-lang]");if(el){var l=el.getAttribute("data-lang");try{localStorage.setItem("applypro-lang",l)}catch(x){}apply(l)}});
apply(L)})();
