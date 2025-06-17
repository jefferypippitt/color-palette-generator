"use client";

import { useState, useRef, useEffect } from "react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageActions,
  MessageAction,
} from "@/components/ui/message";
import { ChatContainer } from "@/components/ui/chat-container";

import {
  DownloadIcon,
  CopyIcon,
  CheckIcon,
  Paperclip,
  ArrowUp,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";

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
  let c = hex.replace("#", "");
  if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#222" : "#fff";
}

// Utility to strip 'Main Colors:' section from AI response
function stripMainColorsSection(text: string) {
  const mainColorsIndex = text.indexOf('Main Colors:');
  return mainColorsIndex !== -1 ? text.slice(0, mainColorsIndex).trim() : text.trim();
}

export default function Chatbot() {
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [colorPalette, setColorPalette] = useState<ColorInfo[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copied, setCopied] = useState<{ [key: string]: boolean }>({});
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [lastUploadedImage, setLastUploadedImage] = useState<{
    file: File;
    preview: string;
  } | null>(null);

  // Scroll to bottom when messages or palette updates
  useEffect(() => {
    if (chatContainerRef.current) {
      setTimeout(() => {
        chatContainerRef.current!.scrollTop =
          chatContainerRef.current!.scrollHeight;
      }, 0);
    }
  }, [messages, colorPalette]);

  // Handle image selection
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!file.type.startsWith("image/")) {
        console.warn("Selected file is not an image.");
        return;
      }

      setSelectedImage(file);

      // Create preview
      const reader = new FileReader();
      reader.onload = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);

      // Do NOT analyze or set colorPalette here
      // Only preview is set, analysis happens on Send
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() && !selectedImage) return;

    const messageId = Date.now().toString();

    // Add user message
    const userMessage: ChatMessage = {
      id: messageId,
      role: "user",
      content: selectedImage
        ? `${input.trim() ? input.trim() + "\n\n" : ""}Selected image: ${
            selectedImage.name
          } (${(selectedImage.size / 1024).toFixed(1)} KB)`
        : input.trim(),
      imagePreview: imagePreview || undefined,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Store the image if it's a new upload
    if (selectedImage && imagePreview) {
      setLastUploadedImage({ file: selectedImage, preview: imagePreview });
    }

    // Clear input and image
    setInput("");
    setSelectedImage(null);
    setImagePreview(null);

    // Add loading message
    const loadingMessage: ChatMessage = {
      id: `${messageId}-loading`,
      role: "assistant",
      content: selectedImage
        ? "Analyzing your image"
        : "Processing your message",
    };
    setMessages((prev) => [...prev, loadingMessage]);

    setIsLoading(true);

    // Use the last uploaded image for follow-up questions
    const imageToUse = selectedImage || lastUploadedImage?.file;

    if (imageToUse) {
      try {
        const formData = new FormData();
        formData.append("image", imageToUse);
        formData.append("mode", selectedImage ? "full" : "followup");
        if (input.trim()) {
          formData.append("question", input.trim());
        }
        // Add current color palette for context in follow-up questions
        if (!selectedImage && colorPalette.length > 0) {
          formData.append("currentPalette", JSON.stringify(colorPalette));
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Failed to analyze image: ${response.status}`);
        }

        // Remove loading message
        setMessages((prev) =>
          prev.filter((msg) => msg.id !== loadingMessage.id)
        );

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let lastChunkTime = Date.now();
        const CHUNK_TIMEOUT = 10000;

        if (!reader) {
          throw new Error("No response stream available");
        }

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (Date.now() - lastChunkTime > CHUNK_TIMEOUT) {
              throw new Error(
                "Stream timeout: No data received for 10 seconds"
              );
            }

            if (done) break;

            lastChunkTime = Date.now();
            const chunk = decoder.decode(value);

            // Process each line in the chunk
            const lines = chunk
              .split("\n")
              .filter((line) => line.startsWith("data: "));

            for (const line of lines) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.text) {
                  accumulatedText += data.text;

                  // Parse and set color palette only for new image uploads
                  if (selectedImage) {
                    const { colors } = parseColorInfo(accumulatedText);
                    if (colors && colors.length > 0) {
                      setColorPalette(colors);
                    }
                  } else if (imageToUse && !selectedImage) {
                    // For follow-up questions, update palette if new colors are found
                    const { colors } = parseColorInfo(accumulatedText);
                    if (colors && colors.length > 0) {
                      setColorPalette(colors);
                    }
                  }

                  // Update or add message with streaming text
                  if (selectedImage) {
                    setMessages((prev) => {
                      const existingMessage = prev.find(
                        (msg) => msg.id === `${messageId}-analysis`
                      );
                      if (existingMessage) {
                        return prev.map((msg) =>
                          msg.id === `${messageId}-analysis`
                            ? {
                                ...msg,
                                content: stripMainColorsSection(accumulatedText),
                              }
                            : msg
                        );
                      } else {
                        return [
                          ...prev,
                          {
                            id: `${messageId}-analysis`,
                            role: "assistant",
                            content: stripMainColorsSection(accumulatedText),
                          },
                        ];
                      }
                    });
                  } else {
                    setMessages((prev) => {
                      const existingMessage = prev.find(
                        (msg) => msg.id === `${messageId}-response`
                      );
                      if (existingMessage) {
                        return prev.map((msg) =>
                          msg.id === `${messageId}-response`
                            ? { ...msg, content: stripMainColorsSection(accumulatedText) }
                            : msg
                        );
                      } else {
                        return [
                          ...prev,
                          {
                            id: `${messageId}-response`,
                            role: "assistant",
                            content: stripMainColorsSection(accumulatedText),
                          },
                        ];
                      }
                    });
                  }
                }

                if (data.error) {
                  throw new Error(data.error);
                }
              } catch (e) {
                console.error("Error processing stream chunk:", e);
                continue;
              }
            }
          }

          // Add color palette message only for new image uploads
          if (selectedImage) {
            const colorMessage: ChatMessage = {
              id: `${messageId}-colors`,
              role: "assistant",
              content: "Here are the main colors from your image:",
            };
            setMessages((prev) => [...prev, colorMessage]);
          }
        } catch (error) {
          console.error("Error processing stream:", error);
          setMessages((prev) => [
            ...prev,
            {
              id: `${messageId}-error`,
              role: "assistant",
              content: `Error: ${
                error instanceof Error
                  ? error.message
                  : "An unknown error occurred"
              }`,
            },
          ]);
          if (selectedImage) {
            setColorPalette([]);
          }
        } finally {
          setIsLoading(false);
          setIsAnalyzing(false);
        }
      } catch (error) {
        console.error("Error analyzing image:", error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === loadingMessage.id
              ? {
                  ...msg,
                  content: `Error: ${
                    error instanceof Error
                      ? error.message
                      : "An unknown error occurred"
                  }`,
                }
              : msg
          )
        );
        if (selectedImage) {
          setColorPalette([]);
        }
      }
    } else {
      // Handle text-only messages
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            question: input.trim(),
            mode: "text-only",
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to process message: ${response.status}`);
        }

        // Remove loading message before processing the response
        setMessages((prev) => prev.filter((msg) => msg.id !== `${messageId}-loading`));

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";

        if (!reader) {
          throw new Error("No response stream available");
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.startsWith("data: "));

          for (const line of lines) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                accumulatedText += data.text;
                setMessages((prev) => {
                  const existingMessage = prev.find(
                    (msg) => msg.id === `${messageId}-response`
                  );
                  if (existingMessage) {
                    return prev.map((msg) =>
                      msg.id === `${messageId}-response`
                        ? { ...msg, content: accumulatedText.trim() }
                        : msg
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        id: `${messageId}-response`,
                        role: "assistant",
                        content: accumulatedText.trim(),
                      },
                    ];
                  }
                });
              }
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (e) {
              console.error("Error processing stream chunk:", e);
              continue;
            }
          }
        }
      } catch (error) {
        console.error("Error processing message:", error);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === `${messageId}-loading`
              ? {
                  ...msg,
                  content: `Error: ${
                    error instanceof Error
                      ? error.message
                      : "An unknown error occurred"
                  }`,
                }
              : msg
          )
        );
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Function to export palette as JSON
  const exportPaletteAsJSON = () => {
    console.log("Current color palette:", colorPalette); // Debug log
    if (!colorPalette || colorPalette.length === 0) {
      console.log("No colors to export"); // Debug log
      return;
    }

    const exportData = colorPalette.map((color: ColorInfo) => ({
      name: color.name,
      hex: color.hex,
      rgb: color.rgb,
    }));

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(
      dataStr
    )}`;

    const exportFileDefaultName = "color-palette.json";
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  // Function to export palette as PNG
  const exportPaletteAsPNG = () => {
    console.log("Current color palette:", colorPalette); // Debug log
    if (!colorPalette || colorPalette.length === 0) {
      console.log("No colors to export"); // Debug log
      return;
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
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

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, totalCanvasWidth, totalCanvasHeight);
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";

    colorPalette.forEach((color: ColorInfo, index: number) => {
      const x = index * colorBlockWidth;

      // Draw Color Block
      ctx.fillStyle = color.hex;
      ctx.fillRect(x, 0, colorBlockWidth, colorBlockHeight);

      // Draw Color Labels
      ctx.fillStyle = getContrastYIQ(color.hex);
      ctx.fillText(
        color.name,
        x + colorBlockWidth / 2,
        colorBlockHeight + textHeight
      );
      ctx.fillText(
        color.hex,
        x + colorBlockWidth / 2,
        colorBlockHeight + textHeight * 2
      );
    });

    const dataUri = canvas.toDataURL("image/png");
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", "color-palette.png");
    linkElement.click();
  };

  // Function to parse color information from the AI response text
  const parseColorInfo = (
    text: string
  ): { colors: ColorInfo[] } => {
    const colorRegex = /(\d+)\.\s*Name:\s*([^,]+),\s*Hex:\s*(#[0-9A-Fa-f]{6}),\s*RGB:\s*\((\d+),\s*(\d+),\s*(\d+)\)/g;
    const colors: ColorInfo[] = [];
    let match;

    while ((match = colorRegex.exec(text)) !== null) {
      colors.push({
        name: match[2].trim(),
        hex: match[3],
        rgb: `(${match[4]}, ${match[5]}, ${match[6]})`,
      });
    }

    return { colors };
  };

  // Copy handler
  const handleCopy = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopied((prev: { [key: string]: boolean }) => ({ ...prev, [key]: true }));
    setTimeout(
      () =>
        setCopied((prev: { [key: string]: boolean }) => ({
          ...prev,
          [key]: false,
        })),
      1200
    );
  };

  return (
    <div className="flex flex-col h-[800px] w-full max-w-7xl mx-auto shadow-sm">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-sm font-semibold">
          Powered by Google
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportPaletteAsJSON}
            className="flex items-center gap-2"
            title={
              colorPalette?.length
                ? "Export palette as JSON"
                : "No colors to export"
            }
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
            title={
              colorPalette?.length
                ? "Export palette as PNG image"
                : "No colors to export"
            }
            disabled={!colorPalette?.length}
          >
            <DownloadIcon className="h-4 w-4" />
            PNG
          </Button>
        </div>
      </div>

      <ChatContainer
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <h2 className="text-2xl font-semibold mb-2">Welcome</h2>
            <p className="text-sm text-muted-foreground">Start a conversation by typing a message below.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {messages.map((message: ChatMessage) => (
              <Message
                key={message.id}
                className={
                  message.role === "user" ? "justify-end" : "justify-start"
                }
              >
                {message.role === "assistant" && (
                  <MessageAvatar
                    src="/IOS_Google_icon.png"
                    alt="AI"
                    fallback="AI"
                  />
                )}
                {message.role === "user" && (
                  <MessageAvatar
                    src="/google-avatar.png"
                    alt="Google"
                    fallback="Google"
                  />
                )}
                {message.role === "user" && message.imagePreview ? (
                  <div className="flex flex-col gap-4 max-w-[500px]">
                    <div className="relative group">
                      <div className="relative w-full aspect-video rounded-xl overflow-hidden border-2 border-primary/20 shadow-sm transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md">
                        <Image
                          src={message.imagePreview}
                          alt="Selected"
                          fill
                          className="object-cover transition-transform duration-200 group-hover:scale-105"
                          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                      </div>
                    </div>
                    {message.content && (
                      <div className="text-sm text-foreground whitespace-pre-line bg-muted/50 p-4 rounded-lg">
                        {message.content}
                      </div>
                    )}
                  </div>
                ) : message.role === "user" ? (
                  <MessageContent className="text-foreground">
                    {message.content}
                  </MessageContent>
                ) : (
                  message.role === "assistant" && (
                    <div className="flex flex-col gap-6 max-w-full">
                      {message.content && !message.id.endsWith("-colors") && (
                        message.id.endsWith("-loading") ? (
                          <div className="flex items-center gap-3">
                            <div className="loading-dots">
                              <span className="text-sm text-foreground">
                                {message.content}
                              </span>
                              <span className="text-sm text-foreground">.</span>
                              <span className="text-sm text-foreground">.</span>
                              <span className="text-sm text-foreground">.</span>
                            </div>
                          </div>
                        ) : (
                          <MessageContent className="text-foreground" markdown>
                            {message.content}
                          </MessageContent>
                        )
                      )}

                      {colorPalette.length > 0 &&
                        message.id.endsWith("-colors") && (
                          <div>
                            <h3 className="text-sm font-medium text-muted-foreground mb-3">
                              Main Colors
                            </h3>
                            <div className="flex gap-3 flex-wrap">
                              {colorPalette.map(
                                (color: ColorInfo, idx: number) => (
                                  <div
                                    key={idx}
                                    className="group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-md shadow-sm transition-all hover:shadow-md select-text"
                                    style={{
                                      backgroundColor: color.hex,
                                      color: getContrastYIQ(color.hex),
                                      position: "relative",
                                    }}
                                  >
                                    <div className="flex flex-col">
                                      <span className="text-sm font-medium">
                                        {color.name}
                                      </span>
                                      <div className="flex items-center gap-1.5 text-xs opacity-90">
                                        <span className="font-mono">
                                          {color.hex}
                                        </span>
                                        <span className="opacity-50">•</span>
                                        <span className="font-mono">
                                          {color.rgb}
                                        </span>
                                      </div>
                                    </div>
                                    <div
                                      className="absolute inset-0 rounded-md transition-opacity opacity-0 group-hover:opacity-10"
                                      style={{
                                        backgroundColor: getContrastYIQ(
                                          color.hex
                                        ),
                                      }}
                                    />
                                  </div>
                                )
                              )}
                            </div>
                            {/* Copy actions row below the grid */}
                            <div className="flex gap-4 mt-4">
                              <MessageActions>
                                <MessageAction
                                  tooltip={
                                    copied.hexAll
                                      ? "Copied!"
                                      : "Copy all hex values"
                                  }
                                >
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 px-3 py-1 rounded bg-muted hover:bg-muted/70 border border-input text-xs font-mono"
                                    onClick={() =>
                                      handleCopy(
                                        colorPalette
                                          .map((c: ColorInfo) => c.hex)
                                          .join(", "),
                                        "hexAll"
                                      )
                                    }
                                    tabIndex={0}
                                    aria-label="Copy all hex values"
                                  >
                                    {copied.hexAll ? (
                                      <CheckIcon className="h-4 w-4 text-green-500" />
                                    ) : (
                                      <CopyIcon className="h-4 w-4" />
                                    )}
                                    Copy All Hex
                                  </button>
                                </MessageAction>
                              </MessageActions>
                              <MessageActions>
                                <MessageAction
                                  tooltip={
                                    copied.rgbAll
                                      ? "Copied!"
                                      : "Copy all RGB values"
                                  }
                                >
                                  <button
                                    type="button"
                                    className="flex items-center gap-1 px-3 py-1 rounded bg-muted hover:bg-muted/70 border border-input text-xs font-mono"
                                    onClick={() =>
                                      handleCopy(
                                        colorPalette
                                          .map((c: ColorInfo) => c.rgb)
                                          .join(", "),
                                        "rgbAll"
                                      )
                                    }
                                    tabIndex={0}
                                    aria-label="Copy all RGB values"
                                  >
                                    {copied.rgbAll ? (
                                      <CheckIcon className="h-4 w-4 text-green-500" />
                                    ) : (
                                      <CopyIcon className="h-4 w-4" />
                                    )}
                                    Copy All RGB
                                  </button>
                                </MessageAction>
                              </MessageActions>
                            </div>
                          </div>
                        )}
                    </div>
                  )
                )}
              </Message>
            ))}
          </div>
        )}
      </ChatContainer>
      {/* Input area visually separated and sticky at the bottom */}
      <div className="p-4 border-t">
        <div className="flex flex-col gap-4">
          {(imagePreview || lastUploadedImage?.preview) && (
            <div className="flex items-center justify-between p-3">
              <div className="relative group">
                <div className="relative w-16 h-16 rounded-xl overflow-hidden border-2 border-primary/20 shadow-sm transition-all duration-200 group-hover:border-primary/40 group-hover:shadow-md">
                  <Image
                    src={imagePreview || lastUploadedImage?.preview || ""}
                    alt="Selected"
                    fill
                    className="object-cover transition-transform duration-200 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedImage?.name || lastUploadedImage?.file.name}
                </span>
                <Button
                  onClick={() => {
                    setSelectedImage(null);
                    setImagePreview(null);
                    setLastUploadedImage(null);
                  }}
                  variant="destructive"
                  size="icon"
                  className="h-6 w-6 shadow-sm hover:shadow-md transition-all duration-200"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
          <div>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              className="hidden"
              onChange={handleImageSelect}
              disabled={isLoading || isAnalyzing}
            />
            <PromptInput
              value={input}
              onValueChange={setInput}
              isLoading={isLoading}
              onSubmit={handleSubmit}
            >
              <div className="flex items-center gap-2">
                <PromptInputTextarea
                  placeholder={
                    lastUploadedImage
                      ? "Ask a question about the image..."
                      : "Type a message or upload an image..."
                  }
                  disabled={isLoading || isAnalyzing}
                  rows={1}
                />
              </div>
              <PromptInputActions className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PromptInputAction tooltip="Attach Image">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading || isAnalyzing}
                      size="icon"
                      className="flex items-center justify-center"
                    >
                      <Paperclip className="h-5 w-5" />
                    </Button>
                  </PromptInputAction>
                </div>

                <PromptInputAction
                  tooltip={isLoading ? "Stop generation" : "Send message"}
                >
                  <Button
                    variant="default"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={handleSubmit}
                    disabled={isLoading || isAnalyzing}
                  >
                    {isLoading ? (
                      <Square className="size-5 fill-current" />
                    ) : (
                      <ArrowUp className="size-5" />
                    )}
                  </Button>
                </PromptInputAction>
              </PromptInputActions>
            </PromptInput>
          </div>
        </div>
      </div>
    </div>
  );
}
