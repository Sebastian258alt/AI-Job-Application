Leitor de texto (OCR) para fotografias de CVs em papel. Corre no dispositivo do utilizador; as fotografias não são enviadas.
Só é carregado quando o utilizador usa a opção de fotografar/escolher imagens do CV.

- tesseract.js 7.0.0 (Apache-2.0): tesseract.min.js, worker.min.js
- tesseract.js-core 7.0.0 (Apache-2.0): core/*-lstm.wasm.js. O worker escolhe automaticamente entre as 3 versões
  (relaxedsimd, simd, sem simd) conforme o navegador; as 3 têm de estar presentes. Só se usam as versões "lstm".
- Dados de língua "tessdata_best_int" (Apache-2.0, projecto Tesseract OCR) via @tesseract.js-data/por e /eng 1.0.0: lang/por.traineddata.gz, lang/eng.traineddata.gz
  (são ficheiros .gz que o próprio tesseract.js descomprime: não os descomprimas nem lhes acrescentes Content-Encoding).

Para actualizar: npm pack tesseract.js@X tesseract.js-core@X @tesseract.js-data/por @tesseract.js-data/eng e copiar os mesmos ficheiros.
