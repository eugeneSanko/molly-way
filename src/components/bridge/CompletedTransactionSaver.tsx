
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { OrderDetails as OrderDetailsType } from "@/hooks/useBridgeOrder";
import { logger } from "@/utils/logger";

interface CompletedTransactionSaverProps {
  orderDetails: OrderDetailsType;
  simulateSuccess: boolean;
  originalOrderDetails: OrderDetailsType | null;
  token: string;
  transactionSaved: boolean;
  setTransactionSaved: (saved: boolean) => void;
  statusCheckDebugInfo: any | null;
  onOrderDetailsUpdate: (updatedDetails: OrderDetailsType) => void;
  setCheckingDb: (checking: boolean) => void;
  hasCheckedExpiredOrderRef: React.MutableRefObject<string | null>;
}

export const CompletedTransactionSaver = ({
  orderDetails,
  simulateSuccess,
  originalOrderDetails,
  token,
  transactionSaved,
  setTransactionSaved,
  statusCheckDebugInfo,
  onOrderDetailsUpdate,
  setCheckingDb,
  hasCheckedExpiredOrderRef
}: CompletedTransactionSaverProps) => {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("orderId");

  useEffect(() => {
    // Skip saving if simulateSuccess is true
    if (simulateSuccess) {
      logger.debug("Skipping transaction save due to simulateSuccess flag");
      return;
    }
    
    // Skip saving if the transaction is already marked as saved
    if (transactionSaved) {
      logger.debug("Transaction already saved, skipping save operation");
      return;
    }

    // Skip saving if we don't have order details or an order ID
    if (!orderDetails || !orderDetails.orderId) {
      logger.warn("Cannot save transaction: missing order details or order ID");
      return;
    }
    
    // Skip saving if the order status is not 'completed'
    if (orderDetails.currentStatus !== 'completed') {
      logger.debug(`Transaction status is ${orderDetails.currentStatus}, skipping save operation`);
      return;
    }
    
    // Skip saving if there's no raw API response
    if (!orderDetails.rawApiResponse) {
      logger.debug("Skipping transaction save: no raw API response available");
      return;
    }

    const saveTransaction = async () => {
      try {
        logger.info("Attempting to save completed transaction to database");

        // Check if the transaction already exists in the database
        const { data: existingTransaction, error: selectError } = await supabase
          .from('bridge_transactions')
          .select('id')
          .eq('ff_order_id', orderDetails.orderId)
          .limit(1);

        if (selectError) {
          logger.error("Error checking for existing transaction:", selectError);
          toast({
            title: "Database Error",
            description: "Failed to check for existing transaction",
            variant: "destructive"
          });
          return;
        }

        if (existingTransaction && existingTransaction.length > 0) {
          logger.info("Transaction already exists in database, updating saved state");
          
          // Update the existing transaction with the latest API response
          if (orderDetails.rawApiResponse) {
            const { error: updateError } = await supabase
              .from('bridge_transactions')
              .update({ 
                status: 'completed',
                raw_api_response: orderDetails.rawApiResponse 
              })
              .eq('ff_order_id', orderDetails.orderId);
              
            if (updateError) {
              logger.error("Error updating transaction with API response:", updateError);
            } else {
              logger.info("Updated existing transaction with API response data");
            }
          }
          
          setTransactionSaved(true);
          return;
        }

        // Collect client metadata - convert readonly array to regular array
        const clientMetadata = {
          ip: 'client-side',
          user_agent: navigator.userAgent,
          languages: Array.from(navigator.languages || [navigator.language]),
          device: {
            width: window.innerWidth,
            height: window.innerHeight,
            platform: navigator.platform,
            vendor: navigator.vendor
          },
          simulation: simulateSuccess
        };

        // Use a more reliable approach with error handling
        try {
          // Insert the transaction data into the database - only for completed transactions
          const { data, error } = await supabase
            .from('bridge_transactions')
            .insert({
              ff_order_id: orderDetails.orderId,
              ff_order_token: orderDetails.ffOrderToken,
              from_currency: orderDetails.fromCurrency,
              to_currency: orderDetails.toCurrency,
              amount: parseFloat(orderDetails.depositAmount),
              destination_address: orderDetails.destinationAddress,
              status: 'completed',
              deposit_address: orderDetails.depositAddress,
              client_metadata: clientMetadata,
              initial_rate: 0, // You might want to replace this with the actual rate
              expiration_time: orderDetails.expiresAt || new Date().toISOString(),
              raw_api_response: orderDetails.rawApiResponse // Store the complete API response
            })
            .select('id');

          if (error) {
            // Handle duplicate key errors gracefully
            if (error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
              logger.info("Transaction already exists in database (constraint violation)");
              setTransactionSaved(true);
            } else {
              throw error;
            }
          } else {
            logger.info("Transaction saved successfully:", data);
            setTransactionSaved(true);
          }
        } catch (dbError) {
          logger.error("Database error saving transaction:", dbError);
          toast({
            title: "Database Error",
            description: "Failed to save transaction",
            variant: "destructive"
          });
        }
      } catch (e) {
        logger.error("Error saving transaction:", e);
        toast({
          title: "Unexpected Error",
          description: "An unexpected error occurred while saving the transaction",
          variant: "destructive"
        });
      }
    };

    saveTransaction();
  }, [
    orderDetails,
    simulateSuccess,
    setTransactionSaved,
    transactionSaved
  ]);
  
  useEffect(() => {
    // Avoid triggering multiple checks for the same order
    const shouldCheckExpiredStatus = 
      (orderDetails?.currentStatus === 'expired' || 
       orderDetails?.rawApiResponse?.status === 'EXPIRED') && 
      hasCheckedExpiredOrderRef.current !== orderDetails.orderId;
      
    if (shouldCheckExpiredStatus) {
      logger.debug("Handling expired order check for", orderDetails.orderId);
      handleExpiredStatus();
    }
  }, [orderDetails]);

  // Handle expired status by checking database for completed transaction - with shorter timeouts
  const handleExpiredStatus = async () => {
    logger.info("Handling expired status");
    
    if (!orderDetails || !orderDetails.orderId || !token) {
      logger.error("Cannot handle expired status: missing order details or token");
      setCheckingDb(false);
      return false;
    }

    try {
      logger.debug("Checking if transaction exists in database");
      
      // Set a timeout for the database query to ensure it doesn't hang
      const queryPromise = supabase
        .from('bridge_transactions')
        .select('*')
        .eq('ff_order_id', orderDetails.orderId)
        .limit(1);
        
      // Create a timeout that rejects after 2 seconds (reduced from ~5s)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Database query timeout")), 2000);
      });
      
      // Race the query against the timeout
      const { data: results, error } = await Promise.race([
        queryPromise,
        timeoutPromise
      ]) as any;
      
      if (error) {
        logger.error("Error checking for transaction:", error);
        toast({
          title: "Database Error",
          description: "Failed to check for transaction status",
          variant: "destructive"
        });
        setCheckingDb(false);
        return false;
      }
      
      // Check if we found the transaction in the database
      if (results && Array.isArray(results) && results.length > 0) {
        logger.debug("Transaction found in database:", results);
        
        const dbTransaction = results[0];
        
        // If the transaction exists in the database, update the order details with raw API response
        if (onOrderDetailsUpdate) {
          logger.info("Updating order details with data from database");
          
          // Create updated order details with data from the database
          const updatedDetails: OrderDetailsType = {
            ...orderDetails,
            currentStatus: "completed",
            rawApiResponse: dbTransaction.raw_api_response || orderDetails.rawApiResponse
          };
          
          // Add a slight delay to avoid UI flicker (reduced from 500ms to 200ms)
          setTimeout(() => {
            onOrderDetailsUpdate(updatedDetails);
            setCheckingDb(false);
          }, 200);
        } else {
          setCheckingDb(false);
        }
        
        // Return true to indicate the transaction was found and status was updated
        return true;
      }
      
      logger.debug("Transaction not found in database, maintaining expired status");
      
      // Clear the loading state with a shorter delay (reduced from 500ms to 200ms)
      setTimeout(() => {
        setCheckingDb(false);
      }, 200);
      
      return false;
    } catch (e) {
      logger.error("Error in handleExpiredStatus:", e);
      toast({
        title: "Error",
        description: "Failed to check transaction status",
        variant: "destructive"
      });
      setCheckingDb(false);
      return false;
    }
  };

  return null;
};
