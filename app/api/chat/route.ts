import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';
import { Buffer } from 'buffer';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GOOGLE_API_KEY) {
      return new Response(JSON.stringify({ 
        error: 'Server configuration error: GOOGLE_API_KEY is not configured' 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const contentType = req.headers.get('content-type') || '';
    let imageFile: File | null = null;
    let mode = 'full';
    let question = '';
    let currentPalette = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      imageFile = formData.get('image') as File;
      mode = formData.get('mode') as string;
      question = formData.get('question') as string;
      currentPalette = formData.get('currentPalette') as string;
    } else if (contentType.includes('application/json')) {
      const json = await req.json();
      question = json.question;
      mode = json.mode;
    }

    if (!imageFile && mode !== 'text-only') {
      return new Response(JSON.stringify({ error: 'No image file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
    });

    let basePrompt = '';
    if (mode === 'text-only') {
      basePrompt = `You are a helpful AI assistant. Please provide a clear and concise response to the following question: ${question}`;
    } else if (mode === 'full') {
      basePrompt = `
First, provide a detailed description of what you see in this image. Focus on:
- The main subject or content
- Any notable elements or patterns
- The overall composition
- Any text or symbols if present

Then, analyze and identify the 3 most dominant colors in the image.

For each color, provide:
- A descriptive name
- Hex code
- RGB value

Format your complete response exactly as follows:

[Your detailed description of the image]

Main Colors:
1. Name: [descriptive name], Hex: [hex code], RGB: [rgb value]
2. Name: [descriptive name], Hex: [hex code], RGB: [rgb value]
3. Name: [descriptive name], Hex: [hex code], RGB: [rgb value]`;
    } else if (mode === 'followup') {
      const paletteContext = currentPalette ? `
Current color palette from previous analysis:
${JSON.parse(currentPalette).map((color: { name: string; hex: string; rgb: string }, index: number) => 
  `${index + 1}. Name: ${color.name}, Hex: ${color.hex}, RGB: ${color.rgb}`
).join('\n')}
` : '';

      basePrompt = `
You are analyzing an image that was previously uploaded. The user has a follow-up question about it.

User's question: ${question}

${paletteContext}

Please provide a detailed and helpful response to their question, focusing specifically on what they're asking about in the image. If their question is about colors, make sure to reference the existing color palette in your response.

Format your response in a clear, conversational way.`;
    }

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    (async () => {
      try {
        if (mode === 'text-only') {
          const result = await model.generateContentStream(basePrompt);
          for await (const chunk of result.stream) {
            const text = chunk.text();
            await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        } else {
          const imageBytes = await imageFile!.arrayBuffer();
          const imageBuffer = Buffer.from(imageBytes);
          
          const result = await model.generateContentStream([
            { text: basePrompt },
            {
              inlineData: { 
                mimeType: imageFile!.type,
                data: imageBuffer.toString('base64')
              }
            }
          ]);

          for await (const chunk of result.stream) {
            const text = chunk.text();
            await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
          }
        }
        await writer.close();
      } catch (error) {
        console.error('Error in stream processing:', error);
        await writer.abort(error);
      }
    })();

    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: unknown) {
    console.error('Error processing request:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'An error occurred',
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}