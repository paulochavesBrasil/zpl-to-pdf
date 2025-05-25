
import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// Adiciona o script do Google AdSense dinamicamente
const script = document.createElement("script");
script.async = true;
script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-7148116003437794";
script.crossOrigin = "anonymous";
document.head.appendChild(script);

// Declare global properties for libraries loaded via script tags
declare global {
  interface Window {
    jspdf: {
      jsPDF: any; // jsPDF constructor
    };
    JSZip: any; // JSZip constructor
    pako: any; // pako library
  }
}

// Utility function to introduce a delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const App: React.FC = () => {
  const [zplFile, setZplFile] = useState<File | null>(null);
  const [zplContent, setZplContent] = useState<string | null>(null);
  // pdfPreviewUrl state is kept for potential future features but not currently used for direct display.
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    setIsDarkMode(prefersDark);
    document.body.classList.toggle('dark-mode', prefersDark);
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
    document.body.classList.toggle('dark-mode', !isDarkMode);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccessMessage(null);
    setPdfPreviewUrl(null); // Clear any old preview URL
    setZplContent(null);
    const file = event.target.files?.[0];

    if (file) {
      if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
        setZplFile(file);
        setFileName(file.name);
        processZipAndConvert(file); // Automatically process and convert
      } else {
        setError('Por favor, selecione um arquivo .zip válido.');
        setZplFile(null);
        setFileName(null);
      }
    }
    event.target.value = ''; // Reset file input
  };

  const processZipAndConvert = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setSuccessMessage(null);
    setPdfPreviewUrl(null);
    setZplContent(null);

    try {
      if (!window.JSZip) {
        throw new Error('Biblioteca JSZip não está carregada. Verifique a inclusão do script JSZip.');
      }
      const jszipInstance = new window.JSZip();
      const zip = await jszipInstance.loadAsync(file);

      let extractedZplContent: string | null = null;
      let foundZplFileNameInZip: string | null = null;

      const filePromises = [];
      for (const relativePath in zip.files) {
        if (Object.prototype.hasOwnProperty.call(zip.files, relativePath)) {
          const zipEntry = zip.files[relativePath];
          if (!zipEntry.dir && (relativePath.toLowerCase().endsWith('.zpl') || relativePath.toLowerCase().endsWith('.txt'))) {
            filePromises.push(
              zipEntry.async('string').then(content => ({ name: relativePath, content }))
            );
          }
        }
      }

      const zplFiles = await Promise.all(filePromises);
      if (zplFiles.length > 0) {
          extractedZplContent = zplFiles[0].content;
          foundZplFileNameInZip = zplFiles[0].name;
          console.log(`Arquivo ZPL encontrado no ZIP: ${foundZplFileNameInZip}`);
      }


      if (extractedZplContent) {
        setZplContent(extractedZplContent);
        await convertToPdfInternal(extractedZplContent);
      } else {
        setError('Nenhum arquivo .zpl ou .txt encontrado dentro do arquivo .zip.');
        setZplFile(null);
        setFileName(null);
      }
    } catch (e: any) {
      console.error('Erro ao processar ZIP ou converter:', e);
      setError(`Erro: ${e.message}`);
      setZplFile(null);
      setFileName(null);
    } finally {
      setIsLoading(false);
    }
  };

  const convertToPdfInternal = async (currentZplContent: string) => {
    const trimmedZplContent = currentZplContent.trim();
    if (!trimmedZplContent) {
      throw new Error('Nenhum comando ZPL fornecido.');
    }

    const zplCommandsToProcess: string[] = [];
    const rawZplSegments = trimmedZplContent
      .split(/\^XZ/i)
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    for (const cmdPart of rawZplSegments) {
      let fullCmd = cmdPart;
      if (!fullCmd.toUpperCase().startsWith('^XA')) {
        fullCmd = '^XA\n' + fullCmd;
      }
      // Ensure it ends with ^XZ, even if the original part was just ^XA or contained ^XZ in the middle.
      // This ensures that what we test for content is properly delimited.
      if (!fullCmd.toUpperCase().endsWith('^XZ')) {
         fullCmd = fullCmd + '\n^XZ';
      }


      const upperCmd = fullCmd.toUpperCase();
      // Check for commands that typically define printable content
      if (upperCmd.includes('^FD') || // Field Data
          upperCmd.includes('^GF') || // Graphic Field
          upperCmd.includes('^BC') || // Barcode (covers ^BCN, ^BCO, etc.)
          upperCmd.includes('^XG') || // Recall Graphic
          upperCmd.includes('^DI')    // Download Image (less common for direct print but indicates content)
         ) {
        zplCommandsToProcess.push(fullCmd);
      } else {
        // This ZPL segment, even when wrapped, likely doesn't print anything.
        // Examples: ^XA^FS^XZ or ^XA^LL200^XZ
        console.log("Descartando segmento ZPL que provavelmente não produzirá etiqueta:", fullCmd);
      }
    }
    
    if (zplCommandsToProcess.length === 0) {
      throw new Error('Nenhum comando ZPL com conteúdo imprimível encontrado após o processamento. Verifique se o ZPL contém comandos como ^FD, ^GF, ^BC, etc.');
    }

    try {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        throw new Error('Biblioteca jsPDF não está carregada corretamente. Verifique a inclusão do script.');
      }
      const JSPDF = window.jspdf.jsPDF;
      const pdf = new JSPDF({
        unit: 'in',
        format: [4,6] // Standard 4x6 label size
      });
      let firstPage = true;
      let commandIndex = 0;

      for (const zplCommand of zplCommandsToProcess) {
        // The check for effectively empty `^XA\n^XZ` is mostly covered by the content check above,
        // but this is a final safeguard.
        const contentTest = zplCommand.toUpperCase().replace(/\^XA/g, '').replace(/\^XZ/g, '').replace(/\s/g, '');
        if (contentTest.length === 0) {
            console.log("Descartando comando ZPL totalmente vazio:", zplCommand);
            continue;
        }

        // Introduce a delay for subsequent requests to avoid rate limiting
        if (commandIndex > 0) {
          console.log("Aguardando 500ms antes da próxima chamada à API Labelary...");
          await sleep(500); // 500ms delay
        }

        const response = await fetch('https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/', {
          method: 'POST',
          headers: {
            'Accept': 'image/png', // We want PNG from Labelary
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: zplCommand,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Falha na API Labelary: ${response.status} - ${errorText.substring(0,150)}`);
        }

        const imageBlob = await response.blob();
        const imageUrl = URL.createObjectURL(imageBlob);
        
        const img = new Image();

        try {
          await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = (err) => {
                  console.error("Erro ao carregar imagem da Labelary:", err);
                  reject(new Error('Falha ao carregar imagem da Labelary para o PDF.'));
              };
              img.src = imageUrl;
          });

          if (!firstPage) {
              pdf.addPage([4,6], 'p');
          }

          const labelWidthInches = 4;
          const labelHeightInches = 6;
          let imgWidthInches = img.width / 203.2; // 8dpmm is approx 203.2 DPI
          let imgHeightInches = img.height / 203.2;

          const widthRatio = labelWidthInches / imgWidthInches;
          const heightRatio = labelHeightInches / imgHeightInches;
          const ratio = Math.min(widthRatio, heightRatio, 1); 

          const finalWidth = imgWidthInches * ratio;
          const finalHeight = imgHeightInches * ratio;

          const xOffset = (labelWidthInches - finalWidth) / 2;
          const yOffset = (labelHeightInches - finalHeight) / 2;

          pdf.addImage(img, 'PNG', xOffset, yOffset, finalWidth, finalHeight);
          firstPage = false;

        } finally {
          URL.revokeObjectURL(imageUrl);
        }
        commandIndex++;
      }

      pdf.save(fileName ? fileName.replace(/\.(zip|zpi)$/i, "") + ".pdf" : 'etiqueta_convertida.pdf');
      setSuccessMessage('PDF gerado e download iniciado!');

    } catch (e: any) {
      console.error('Erro na conversão para PDF:', e);
      const errorMessage = e instanceof Error ? e.message : String(e);
      throw new Error(`${errorMessage}`); 
    }
  };

  const triggerFileInput = () => {
    document.getElementById('zplFileInput')?.click();
  };

  return (
    <>
      <button onClick={toggleTheme} className="theme-toggle" aria-label="Alternar tema">
        {isDarkMode ? 'Modo Claro' : 'Modo Escuro'}
      </button>
      <div className="container">
        <h1>ZPL para PDF Conversor</h1>

        <div className="file-input-area" onClick={triggerFileInput} role="button" tabIndex={0}
             onKeyPress={(e) => { if (e.key === 'Enter' || e.key === ' ') triggerFileInput(); }}
             aria-label="Clique para adicionar arquivo ZIP">
          <input
            type="file"
            id="zplFileInput"
            accept=".zip,application/zip,application/x-zip-compressed"
            onChange={handleFileChange}
            aria-hidden="true"
            style={{display: 'none'}}
          />
          <p className="file-input-label-text">
            Clique para adicionar arquivo .zip
          </p>
          {fileName && <p className="file-name" aria-live="polite">Arquivo selecionado: {fileName}</p>}
        </div>

        {isLoading && <div className="loader" aria-label="Carregando"></div>}

        {error && <p className="status-message error" role="alert">{error}</p>}
        {successMessage && <p className="status-message success" role="alert">{successMessage}</p>}

      </div>
    </>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
