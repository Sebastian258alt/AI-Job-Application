Bibliotecas de terceiros alojadas localmente (sem CDN), nas versões que a aplicação já usava:
- pdf.js (pdfjs-dist) 3.11.174, Apache-2.0: pdf.min.js, pdf.worker.min.js
- mammoth 1.6.0, BSD-2-Clause: mammoth.browser.min.js
- jsPDF 4.2.1, MIT: jspdf.umd.min.js (cria PDFs no navegador; só é carregada quando o utilizador descarrega um PDF)
São carregadas por js/cv-input.js só quando o utilizador envia um PDF/DOCX. Para actualizar: npm pack pdfjs-dist@X mammoth@Y jspdf@Z e copiar os ficheiros.
