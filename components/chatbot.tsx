"use client";

import { useState, useRef, useEffect } from "react";
import { PromptInput, PromptInputTextarea, PromptInputActions } from "@/components/ui/prompt-input";
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message";
import { ChatContainer } from "@/components/ui/chat-container";

import { ImageIcon, Loader2, DownloadIcon, CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from 'next/image';

type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  imagePreview?: string;
};

type ColorInfo = {
  hex: string;
  rgb: string;
  name: string;
};

// Utility function for text contrast
function getContrastYIQ(hex: string) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
  const r = parseInt(c.substr(0,2),16);
  const g = parseInt(c.substr(2,2),16);
  const b = parseInt(c.substr(4,2),16);
  const yiq = ((r*299)+(g*587)+(b*114))/1000;
  return yiq >= 128 ? '#222' : '#fff';
}

export default function Chatbot() {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorInfo[]>([]);
  const [streamProgress, setStreamProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({});
  
  // Scroll to bottom when messages or palette updates
  useEffect(() => {
    if (chatContainerRef.current) {
      setTimeout(() => {
        chatContainerRef.current!.scrollTop = chatContainerRef.current!.scrollHeight;
      }, 0);
    }
  }, [messages, colorPalette]);

  // Handle image selection
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file.type.startsWith('image/')) {
        console.warn('Selected file is not an image.');
        return;
      }
      
      // Create a promise to handle the FileReader
      const imagePreview = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve(reader.result as string);
        };
        reader.readAsDataURL(file);
      });

      // Add informative message about the selected image
      const messageId = Date.now().toString();
      const userMessage: ChatMessage = {
        id: messageId,
        role: "user",
        content: `Selected image: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`,
        imagePreview
      };
      setMessages((prev: ChatMessage[]) => [...prev, userMessage]);

      // Add AI's analysis message
      const assistantMessage: ChatMessage = {
        id: `${messageId}-analysis`,
        role: "assistant",
        content: "Analyzing image content and colors..."
      };
      setMessages((prev: ChatMessage[]) => [...prev, assistantMessage]);

      setIsLoading(true);
      setIsAnalyzing(true);
      setStreamProgress(0);
      setColorPalette([]); // Clear previous palette

      try {
        const formData = new FormData();
        formData.append("image", file);
        formData.append("mode", "full"); // New mode for combined analysis

        const response = await fetch("/api/chat", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to analyze image: ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let lastChunkTime = Date.now();
        const CHUNK_TIMEOUT = 10000;
        let totalChunks = 0;
        let processedChunks = 0;

        if (!reader) {
          throw new Error("No response stream available");
        }

        while (true) {
          const { done, value } = await reader.read();
          
          if (Date.now() - lastChunkTime > CHUNK_TIMEOUT) {
            throw new Error("Stream timeout: No data received for 10 seconds");
          }
          
          if (done) break;

          lastChunkTime = Date.now();
          const chunk = decoder.decode(value);
          
          const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
          totalChunks += lines.length;

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.text) {
                accumulatedText += data.text;
                processedChunks++;
                setStreamProgress(Math.min(100, (processedChunks / totalChunks) * 100));
                
                // Parse and set color palette
                const { colors, filteredText } = parseColorInfo(accumulatedText);
                if (colors && colors.length > 0) {
                  setColorPalette(colors);
                }
                
                // Update assistant message with filtered text
                setMessages((prev: ChatMessage[]) =>
                  prev.map((msg: ChatMessage) =>
                    msg.id === assistantMessage.id
                      ? { ...msg, content: filteredText }
                      : msg
                  )
                );
              }
              
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error('Error processing stream chunk:', e);
              continue;
            }
          }
        }

        // Add a final message to indicate completion
        const completionMessage: ChatMessage = {
          id: `${messageId}-complete`,
          role: "assistant",
          content: "Analysis complete! You can export the color palette using the buttons above."
        };
        setMessages((prev: ChatMessage[]) => [...prev, completionMessage]);

      } catch (error) {
        console.error("Error analyzing image:", error);
        setMessages((prev: ChatMessage[]) =>
          prev.map((msg: ChatMessage) =>
            msg.id === assistantMessage.id
              ? { ...msg, content: `Error: ${error instanceof Error ? error.message : "An unknown error occurred"}` }
              : msg
          )
        );
        setColorPalette([]);
      } finally {
        setIsLoading(false);
        setIsAnalyzing(false);
        setStreamProgress(0);
      }
    }
  };

  // Function to trigger file input click
  const openFileSelector = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Function to export palette as JSON
  const exportPaletteAsJSON = () => {
    console.log('Current color palette:', colorPalette); // Debug log
    if (!colorPalette || colorPalette.length === 0) {
      console.log('No colors to export'); // Debug log
      return;
    }
    
    const exportData = colorPalette.map((color: ColorInfo) => ({
      name: color.name,
      hex: color.hex,
      rgb: color.rgb
    }));

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;
    
    const exportFileDefaultName = 'color-palette.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  // Function to export palette as PNG
  const exportPaletteAsPNG = () => {
    console.log('Current color palette:', colorPalette); // Debug log
    if (!colorPalette || colorPalette.length === 0) {
      console.log('No colors to export'); // Debug log
      return;
    }
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error("Canvas rendering not supported");
      return;
    }
    
    const colorBlockWidth = 100;
    const colorBlockHeight = 50;
    const textHeight = 15;
    const totalCanvasHeight = colorBlockHeight + textHeight * 2 + 20;
    const totalCanvasWidth = colorBlockWidth * colorPalette.length;

    canvas.width = totalCanvasWidth;
    canvas.height = totalCanvasHeight;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, totalCanvasWidth, totalCanvasHeight);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';

    colorPalette.forEach((color: ColorInfo, index: number) => {
      const x = index * colorBlockWidth;

      // Draw Color Block
      ctx.fillStyle = color.hex;
      ctx.fillRect(x, 0, colorBlockWidth, colorBlockHeight);

      // Draw Color Labels
      ctx.fillStyle = getContrastYIQ(color.hex);
      ctx.fillText(color.name, x + colorBlockWidth / 2, colorBlockHeight + textHeight);
      ctx.fillText(color.hex, x + colorBlockWidth / 2, colorBlockHeight + textHeight * 2);
    });
    
    const dataUri = canvas.toDataURL('image/png');
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', 'color-palette.png');
    linkElement.click();
  };

  // Function to parse color information from the AI response text
  const parseColorInfo = (text: string): { colors: ColorInfo[], filteredText: string } => {
    // Updated regex patterns to better match the format
    const nameRegex = /Name:\s*([^,]+)/g;
    const hexRegex = /Hex:\s*#([0-9A-Fa-f]{6})/g;
    const rgbRegex = /RGB:\s*\((\d+),\s*(\d+),\s*(\d+)\)/g;

    // Extract all matches
    const names = Array.from(text.matchAll(nameRegex)).map(match => match[1].trim());
    const hexMatches = Array.from(text.matchAll(hexRegex)).map(match => `#${match[1]}`);
    const rgbMatches = Array.from(text.matchAll(rgbRegex)).map(match => `rgb(${match[1]}, ${match[2]}, ${match[3]})`);

    if (names.length === 0 || hexMatches.length === 0 || rgbMatches.length === 0) {
      return { colors: [], filteredText: text };
    }

    // Create color info objects
    const result = names.map((name, index) => ({
      name,
      hex: hexMatches[index] || '',
      rgb: rgbMatches[index] || ''
    }));

    // Remove color information from the text
    const filteredText = text
      .replace(/Name:\s*[^,]+,\s*Hex:\s*#[0-9A-Fa-f]{6},\s*RGB:\s*\(\d+,\s*\d+,\s*\d+\)/g, '')
      .replace(/Main Colors:/g, '')
      .replace(/\n\s*\n/g, '\n') // Remove extra newlines
      .trim();

    return { colors: result, filteredText };
  };

  // Copy handler
  const handleCopy = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopied((prev: { [key: string]: boolean }) => ({ ...prev, [key]: true }));
    setTimeout(() => setCopied((prev: { [key: string]: boolean }) => ({ ...prev, [key]: false })), 1200);
  };

  return (
    <div className="flex flex-col h-[700px] w-full max-w-7xl mx-auto rounded-lg border shadow-sm">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Color Palette Generator with detailed description of images</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportPaletteAsJSON}
            className="flex items-center gap-2"
            title={colorPalette?.length ? "Export palette as JSON" : "No colors to export"}
            disabled={!colorPalette?.length}
          >
            <DownloadIcon className="h-4 w-4" />
            JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportPaletteAsPNG}
            className="flex items-center gap-2"
            title={colorPalette?.length ? "Export palette as PNG image" : "No colors to export"}
            disabled={!colorPalette?.length}
          >
            <DownloadIcon className="h-4 w-4" />
            PNG
          </Button>
        </div>
      </div>

      <ChatContainer ref={chatContainerRef} className="p-4 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-8">
          {messages.map((message: ChatMessage) => (
            <Message key={message.id} className={message.role === "user" ? "justify-end" : "justify-start"}>
              {message.role === "assistant" && (
                <MessageAvatar src="/avatars/ai.png" alt="AI" fallback="AI" />
              )}
              {message.role === "user" && message.imagePreview ? (
                <div className="flex flex-col gap-2 max-w-[300px] bg-muted/50 p-3 rounded-lg">
                  <div className="relative w-full h-48 rounded-lg overflow-hidden border shadow-sm">
                    <Image
                      src={message.imagePreview}
                      alt="Selected"
                      fill
                      className="object-contain"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{message.content.split(':')[0]}</span>
                    {message.content.split(':')[1]}
                  </div>
                </div>
              ) : message.role === "assistant" && message.id === messages[messages.length - 1]?.id ? (
                <div className="flex flex-col gap-6 max-w-full">
                  {isAnalyzing && (
                    <div className="flex flex-col gap-3 text-sm text-muted-foreground mb-4">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="font-medium">Analyzing colors<span className="thinking"></span></span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full analyzing transition-all duration-300"
                          style={{ width: `${streamProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  
                  <div>
                    <h3 className="text-sm font-medium text-muted-foreground mb-3">Main Colors</h3>
                    <div className="flex gap-2 flex-wrap">
                      {colorPalette.map((color: ColorInfo, idx: number) => (
                        <div
                          key={idx}
                          className="group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-md shadow-sm transition-all hover:shadow-md select-text"
                          style={{
                            backgroundColor: color.hex,
                            color: getContrastYIQ(color.hex),
                            position: 'relative',
                          }}
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{color.name}</span>
                            <div className="flex items-center gap-1.5 text-xs opacity-90">
                              <span className="font-mono">{color.hex}</span>
                              <span className="opacity-50">•</span>
                              <span className="font-mono">{color.rgb}</span>
                            </div>
                          </div>
                          <div 
                            className="absolute inset-0 rounded-md transition-opacity opacity-0 group-hover:opacity-10"
                            style={{ backgroundColor: getContrastYIQ(color.hex) }}
                          />
                        </div>
                      ))}
                    </div>
                    {/* Copy actions row below the grid */}
                    <div className="flex gap-4 mt-4">
                      <MessageActions>
                        <MessageAction tooltip={copied.hexAll ? 'Copied!' : 'Copy all hex values'}>
                          <button
                            type="button"
                            className="flex items-center gap-1 px-3 py-1 rounded bg-muted hover:bg-muted/70 border border-input text-xs font-mono"
                            onClick={() => handleCopy(colorPalette.map((c: ColorInfo) => c.hex).join(', '), 'hexAll')}
                            tabIndex={0}
                            aria-label="Copy all hex values"
                          >
                            {copied.hexAll ? <CheckIcon className="h-4 w-4 text-green-500" /> : <CopyIcon className="h-4 w-4" />}
                            Copy All Hex
                          </button>
                        </MessageAction>
                      </MessageActions>
                      <MessageActions>
                        <MessageAction tooltip={copied.rgbAll ? 'Copied!' : 'Copy all RGB values'}>
                          <button
                            type="button"
                            className="flex items-center gap-1 px-3 py-1 rounded bg-muted hover:bg-muted/70 border border-input text-xs font-mono"
                            onClick={() => handleCopy(colorPalette.map((c: ColorInfo) => c.rgb).join(', '), 'rgbAll')}
                            tabIndex={0}
                            aria-label="Copy all RGB values"
                          >
                            {copied.rgbAll ? <CheckIcon className="h-4 w-4 text-green-500" /> : <CopyIcon className="h-4 w-4" />}
                            Copy All RGB
                          </button>
                        </MessageAction>
                      </MessageActions>
                    </div>
                  </div>
                </div>
              ) : (
                <MessageContent markdown>
                  {message.content}
                </MessageContent>
              )}
            </Message>
          ))}
        </div>
      </ChatContainer>

      <div className="p-4 border-t">
        <div>
          <input 
            type="file" 
            accept="image/*" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={handleImageSelect}
            disabled={isLoading}
          />
          
          <PromptInput>
            <div className="flex items-center gap-2">
              <PromptInputTextarea
                placeholder="Upload an image to analyze its colors..."
                disabled={true}
                rows={1}
              />
              <PromptInputActions>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openFileSelector}
                  title="Upload image"
                  disabled={isLoading}
                  type="button"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                </Button>
              </PromptInputActions>
            </div>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}