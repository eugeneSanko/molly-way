
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QrCode, Clipboard } from "lucide-react";
import { toast } from "sonner";

interface DestinationAddressInputProps {
  value: string;
  onChange: (value: string) => void;
  borderColor?: string;
  receivingCurrency?: string;
  currencyNetwork?: string;
}

export const DestinationAddressInput = ({
  value,
  onChange,
  borderColor,
  receivingCurrency = "",
  currencyNetwork = "",
}: DestinationAddressInputProps) => {
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      onChange(text); // Update the input value with the pasted text
      toast.success("Address pasted from clipboard!");
    } catch (error) {
      console.error("Failed to paste address:", error);
      toast.error("Failed to paste address.");
    }
  };

  // Create a style object for the border color
  const borderStyle = borderColor
    ? {
        borderColor: borderColor,
        borderWidth: "2px",
      }
    : {};

  // Create dynamic placeholder based on receiving currency
  const placeholder = receivingCurrency
    ? `Enter ${receivingCurrency} wallet address`
    : "Enter receiving wallet address";
    
  // Create dynamic label with network information
  const networkLabel = currencyNetwork && receivingCurrency
    ? `Destination Wallet Address (${currencyNetwork})`
    : "Destination Wallet Address (Receiving Network)";

  return (
    <div>
      <label className="block text-sm font-medium mb-2 text-gray-300">
        {networkLabel}
      </label>
      <div className="relative">
        <Input
          type="text"
          placeholder={placeholder}
          className="h-[3.5rem] sm:h-[4.5rem] px-3 sm:px-4 bg-secondary/30 pr-16 sm:pr-24 text-sm sm:text-base transition-all duration-200 h-64"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={borderStyle}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 sm:gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8">
            <QrCode className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 sm:h-8 sm:w-8"
            onClick={handlePaste}
          >
            <Clipboard className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};
