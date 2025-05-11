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

    const formData = await req.formData();
    const imageFile = formData.get('image') as File;
    const mode = formData.get('mode') as string;
    
    if (!imageFile) {
      return new Response(JSON.stringify({ error: 'No image file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const imageBytes = await imageFile.arrayBuffer();
    const imageBuffer = Buffer.from(imageBytes);

    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
    });

    let basePrompt = '';
    
    if (mode === 'full') {
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
    } else {
      basePrompt = `
Analyze this image and identify the 3 most dominant colors.

For each color, provide:
- A descriptive name
- Hex code
- RGB value

Format the response exactly as follows:

1. Name: [descriptive name], Hex: [hex code], RGB: [rgb value]
2. Name: [descriptive name], Hex: [hex code], RGB: [rgb value]
3. Name: [descriptive name], Hex: [hex code], RGB: [rgb value]`;
    }
    
    const result = await model.generateContentStream([
      { text: basePrompt },
      {
        inlineData: { 
          mimeType: imageFile.type,
          data: imageBuffer.toString('base64')
        }
      }
    ]);

    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    (async () => {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
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